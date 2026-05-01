const Database = require('better-sqlite3');
const db = new Database('database.sqlite');
console.log("Attendance:", db.prepare("PRAGMA table_info(attendance)").all());
console.log("Traits:", db.prepare("PRAGMA table_info(affective_psychomotor)").all());
console.log("Settings:", db.prepare("SELECT * FROM settings").all());
