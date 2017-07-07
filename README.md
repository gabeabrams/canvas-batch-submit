# Batch Submit
Easily make the same file submission for many students at once
<hr>

### Instructions:
1. Clone this repository  
`git clone https://github.com/gabeabrams/canvas-batch-submit.git`  

2. Add students to the `students.csv` CSV file.  
Note: only the "token" column is important. This column must each student's Canvas access token.  

3. Add files to `files_to_submit/`. All files in this folder will be submitted.  

4. Run `node app.js` and follow the instructions in terminal.

<hr>

### More Help

You need `node.js` to run this script. This tool was tested on v6.10.3.  
[Download/Install Node](https://nodejs.org/en/download/)

To run the app, you must be in the terminal in the same folder as `app.js`. 