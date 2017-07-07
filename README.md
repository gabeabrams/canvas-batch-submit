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