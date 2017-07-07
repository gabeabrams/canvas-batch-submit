var Promise = require('promise');
var prompt = require('prompt');
var fs = require('fs');
var urlLib = require('url');
var querystring = require('querystring');
var https = require('https');
var async = require('async');
var request = require('request');
var locks = require('locks');

// PROMPT HELPERS
prompt.start();
function getInput(promptText) {
  return new Promise(function (resolve, reject) {
    prompt.get(promptText, function (err, result) {
      if (err) {
        reject(err);
      } else {
        resolve(result[promptText]);
      }
    });
  });
}

// FILE READING
function fileValid(filename) {
  return fs.existsSync(__dirname + '/' + filename);
}

// CSV READING
function readCSV(filename) {
  if (!filename.endsWith('.csv')) {
    filename += '.csv';
  }
  return new Promise(function (resolve, reject) {
    fs.readFile(filename, "utf8", function(err, fileContents) {
      if (err || !fileContents) {
        return reject('That CSV file could not be read');
      }
      
      var headers = [];
      var rows = [];
      var lines = fileContents.split('\n');
      if (lines.length > 0) {
        var parts = lines[0].split(',');
        parts.forEach(function (part) {
          headers.push(part.trim());
        });
      }
      for (var i = 1; i < lines.length; i++) {
        var row = [];
        var parts = lines[i].split(',');
        parts.forEach(function (part) {
          row.push(part.trim());
        });
        rows.push(row);
      }
      resolve({
        headers: headers,
        rows: rows
      });
    });
  });
}

// URL PARSING
function parseAssignmentUrl(url) {
  var parts = url.split('/');
  var courseID, assignmentID;
  for (var i = 0; i < parts.length - 1; i++) {
    if (parts[i] === 'courses') {
      courseID = parts[i+1];
      i++;
    }
    if (parts[i] === 'assignments') {
      assignmentID = parts[i+1];
      i++;
    }
  }
  return {
    courseID: courseID,
    assignmentID: assignmentID
  }
}

// HTTPS REQUEST
// Send HTTPS request to url using method and params.
function httpsRequest(url, params, method) {
  return new Promise(function (resolve, reject) {
    // Parse url into host and path
    var parsedURL = urlLib.parse(url);
    var host = parsedURL.hostname;
    var path = parsedURL.path;

    // Reformat params for Canvas
    var newParams = {};
    for (var key in params) {
      if (params.hasOwnProperty(key)) {
        if (Array.isArray(params[key])) {
          newParams[key + '[]'] = params[key];
        } else {
          newParams[key] = params[key];
        }
      }
    }

    // Save params to string
    var postData = querystring.stringify(newParams);

    // Prepare request
    var options = {
      host: host,
      path: path,
      method: method || 'GET',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': postData.length
      }
    };

    // Send request
    var req = https.request(options, function (res) {
      var text = '';

      // Save a chunk of the response
      res.on('data', function (chunk) {
        text += chunk;
      });

      // On finishing, send full response
      res.on('end', function () {
        return resolve({text: text, res: res});
      });

      // Catch communication errors
      res.on('error', function (err) {
        return reject(err);
      });
    });

    // Write and close connection
    req.write(postData);
    req.end();
  }.bind(this));
}

function processCanvasResponse(response) {
  text = response.text.replace('while(1);', '');
  try {
    var json = JSON.parse(text);
    return json;
  } catch (err) {
    return null;
  }
}

// Upload a file
function uploadFile(courseID, assignmentID, accessToken, filename) {
  return new Promise(function (resolve, reject) {
    var url = 'https://canvas.harvard.edu/api/v1/courses/' + courseID + '/assignments/' + assignmentID + '/submissions/self/files';
    var method = 'POST';
    var params = {
      name: filename,
      access_token: accessToken
    };

    httpsRequest(url, params, method)
    .then(function (response) {
      response = processCanvasResponse(response);

      var uploadUrl = response.upload_url;
      var uploadParams = response.upload_params;
       
      var formData = uploadParams;
      formData.file = fs.createReadStream(__dirname + '/files_to_submit/' + filename);

      request.post({
        url: uploadUrl,
        formData: formData
      }, function (err, httpResponse, body) {
        if (err || !httpResponse || !httpResponse.headers || !httpResponse.headers.location) {
          // An upload error occurred
          console.log(err);
          return reject(new Error('The file could not be securely uploaded to Canvas.'));
        }
        var location = httpResponse.headers.location;

        httpsRequest(location, {}, 'GET')
        .then(function (finalResponse) {
          finalResponse = processCanvasResponse(finalResponse);
          if (!finalResponse) {
            return reject(new Error('Canvas responded improperly when we confirmed a submission upload.'));
          }
          var fileID = finalResponse.id;
          return resolve(fileID);
        })
        .catch(function (err) {
          return reject(new Error('We encountered an error while confirming a submission upload.'));
        });
      });
    })
    .catch(function (err) {
      return reject(new Error('We encountered an error while sending a file to Canvas.'));
    });
  });
}

// Submit an assignment
function submitAssignment(courseID, assignmentID, accessToken, filenames) {
  return new Promise(function (resolve, reject) {
    function _fileUploadHelper(filename, next) {
      uploadFile(courseID, assignmentID, accessToken, filename)
      .then(function (response) {
        next(null, response);
      })
      .catch(function (err) {
        next(err);
      });
    };
    async.map(filenames, _fileUploadHelper, function (err, fileIDs) {
      var url = 'https://canvas.harvard.edu/api/v1/courses/' + courseID + '/assignments/' + assignmentID + '/submissions';
      var method = 'POST';
      var params = {};
      params['submission[submission_type]'] = 'online_upload';
      params['submission[file_ids]'] = fileIDs;
      params['access_token'] = accessToken;

      httpsRequest(url, params, method)
      .then(function (response) {
        response = processCanvasResponse(response);
        resolve(response);
      })
      .catch(reject);
    });
  });
}





if (!fileValid('students.csv')) {
  console.log('A students CSV file needs to be included in this directory.');
  process.exit();
}


var tokens, courseID, assignmentID, filenames;
// Get list of students
readCSV('students.csv')
.then(function (csvData) {
  // Find token column
  var tokenCol = -1;
  for (var i = 0; i < csvData.headers.length; i++) {
    var headerName = csvData.headers[i].trim().toLowerCase();
    if (headerName === 'token') {
      tokenCol = i;
      break;
    }
  }
  if (tokenCol === -1) {
    // Token column couldn't be found
    throw new Error('No "token" column could be found in the students CSV file.');
  }
  // Post-process students
  tokens = [];
  csvData.rows.forEach(function (row) {
    tokens.push(row[tokenCol]);
  });
  if (tokens.length === 0) {
    console.log('Error: no students found in students.csv.');
    process.exit(1);
    return;
  }

  // Get the file(s) to submit
  return new Promise(function (resolve, reject) {
    fs.readdir(__dirname + '/files_to_submit', function (err, files) {
      if (err) {
        return reject(err);
      }
      return resolve(files);
    });
  });
})
.then(function (filenamesData) {
  filenames = [];
  // Skip hidden files
  filenamesData.forEach(function (name) {
    if (!name.startsWith('.')) {
      filenames.push(name);
    }
  });
  
  if (filenames.length === 0) {
    // No files to submit
    console.log('Error: no files to submit! (cancelling)');
    process.exit(1);
    return;
  } else {
    // Tell user which files we'll submit
    console.log('The following files will be submitted for ' + tokens.length + ' student' + (tokens.length === 1 ? '' : 's') + ':');
    filenames.forEach(function (name) {
      console.log('> /files_to_submit/' + name);
    });
    console.log('If this is a mistake, use ctrl+c to exit.\n');
  }


  // Get the assignment
  return getInput('url of Canvas assignment');
})
.then(function (assignmentUrl) {
  var info = parseAssignmentUrl(assignmentUrl);
  courseID = info.courseID;
  assignmentID = info.assignmentID;


  var printMutex = locks.createMutex();
  var numStudentsFinished = 0;

  // Send off all submissions
  function _submitHelper(token, next) {
    submitAssignment(courseID, assignmentID, token, filenames)
    .then(function (response) {
      printMutex.lock(function () {
        numStudentsFinished += 1;
        console.log('> Finished ' + numStudentsFinished + '/' + tokens.length);
        printMutex.unlock();
        next(null, true);
      });
    })
    .catch(function (err) {
      next(err);
    });
  };
  async.map(tokens, _submitHelper, function (err, responses) {
    if (err) {
      throw new Error('Error while asynchronously submitting assignments', err);
    }
    console.log('\nAll done!\n' + responses.length + ' students submitted this assignment.');
  });
})
.catch(function (err) {
  console.log('-------------------------');
  console.log('An error occurred!');
  console.error(err);
});