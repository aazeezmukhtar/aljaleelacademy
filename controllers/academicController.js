const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../database.sqlite'));

const getAcademicDashboard = (req, res) => {
    try {
        const classes = db.prepare('SELECT * FROM classes').all();
        const subjects = db.prepare('SELECT * FROM subjects').all();
        const teachers = db.prepare("SELECT id, first_name, last_name, staff_id FROM staff WHERE status != 'inactive' ORDER BY last_name").all();
        const assignments = db.prepare(`
            SELECT sa.*, t.first_name, t.last_name, s.name as subject_name, c.name as class_name
            FROM subject_assignments sa
            JOIN staff t ON sa.teacher_id = t.id
            JOIN subjects s ON sa.subject_id = s.id
            JOIN classes c ON sa.class_id = c.id
            ORDER BY sa.session DESC, t.first_name, t.last_name
        `).all();

        res.render('academics/index', {
            title: 'Academic Management',
            classes,
            subjects,
            teachers,
            assignments
        });
    } catch (err) {
        console.error('Academic Dashboard Error:', err);
        res.status(500).send('DEBUG_ERROR_TRACE: ' + err.message + ' | Stack: ' + err.stack);
    }
};

// Class Management
const addClass = (req, res) => {
    const { name } = req.body;
    try {
        db.prepare('INSERT INTO classes (name) VALUES (?)').run(name);
        res.redirect('/academics');
    } catch (err) {
        console.error('Add Class Error:', err);
        res.status(500).send('Error adding class');
    }
};

const deleteClass = (req, res) => {
    const { id } = req.params;
    try {
        const deleteTransaction = db.transaction(() => {
            // 1. Students: Nullify arm and class references
            // First, nullify arm references for any student assigned to an arm of this class
            db.prepare(`
                UPDATE students 
                SET current_arm_id = NULL 
                WHERE current_arm_id IN (SELECT id FROM arms WHERE class_id = ?)
            `).run(id);
            
            // Then nullify the class reference itself
            db.prepare('UPDATE students SET current_class_id = NULL WHERE current_class_id = ?').run(id);

            // 2. Class assignments: Clear both class and arm references
            db.prepare('DELETE FROM class_assignments WHERE class_id = ?').run(id);

            // 3. Subject assignments
            db.prepare('DELETE FROM subject_assignments WHERE class_id = ?').run(id);

            // 4. Class board posts
            db.prepare('DELETE FROM class_posts WHERE class_id = ?').run(id);

            // 5. Attendance records
            db.prepare('DELETE FROM attendance WHERE class_id = ?').run(id);

            // 6. Fee Cleanup: Payments, Student Fees, and Categories
            const feeCats = db.prepare('SELECT id FROM fee_categories WHERE class_id = ?').all(id);
            for (const fc of feeCats) {
                // Delete payments associated with fees of this category
                db.prepare(`
                    DELETE FROM payments 
                    WHERE student_fee_id IN (SELECT id FROM student_fees WHERE fee_category_id = ?)
                `).run(fc.id);
                
                // Delete student fees of this category
                db.prepare('DELETE FROM student_fees WHERE fee_category_id = ?').run(fc.id);
                
                // Delete the category itself
                db.prepare('DELETE FROM fee_categories WHERE id = ?').run(fc.id);
            }

            // 7. Arms: Now safe to delete since students and assignments are cleared
            db.prepare('DELETE FROM arms WHERE class_id = ?').run(id);

            // 8. Class: Finally delete the class record
            db.prepare('DELETE FROM classes WHERE id = ?').run(id);
        });

        deleteTransaction();
        res.redirect('/academics');
    } catch (err) {
        console.error('Delete Class Error:', err);
        res.status(500).send('Error deleting class: ' + err.message);
    }
};

// Subject Management
const addSubject = (req, res) => {
    const { name, code } = req.body;
    try {
        db.prepare('INSERT INTO subjects (name, code) VALUES (?, ?)').run(name, code);
        res.redirect('/academics');
    } catch (err) {
        console.error('Add Subject Error:', err);
        res.status(500).send('Error adding subject');
    }
};

const editSubjectForm = (req, res) => {
    const { id } = req.params;
    try {
        const subject = db.prepare('SELECT * FROM subjects WHERE id = ?').get(id);
        if (!subject) return res.status(404).send('Subject not found');
        res.render('academics/edit-subject', {
            title: 'Edit Subject',
            subject
        });
    } catch (err) {
        console.error('Edit Subject Form Error:', err);
        res.status(500).send('Database Error');
    }
};

const updateSubject = (req, res) => {
    const { id } = req.params;
    const { name, code } = req.body;
    try {
        db.prepare('UPDATE subjects SET name = ?, code = ? WHERE id = ?').run(name, code, id);
        res.redirect('/academics');
    } catch (err) {
        console.error('Update Subject Error:', err);
        res.status(500).send('Error updating subject');
    }
};

const deleteSubject = (req, res) => {
    const { id } = req.params;
    try {
        db.prepare('DELETE FROM subjects WHERE id = ?').run(id);
        res.redirect('/academics');
    } catch (err) {
        console.error('Delete Subject Error:', err);
        res.status(500).send('Error deleting subject');
    }
};

// Subject Assignment Management
const addAssignment = (req, res) => {
    const { teacher_id, subject_id, class_id, session } = req.body;
    try {
        db.prepare(`
            INSERT INTO subject_assignments (teacher_id, subject_id, class_id, session)
            VALUES (?, ?, ?, ?)
        `).run(teacher_id, subject_id, class_id, session);
        res.redirect('/academics');
    } catch (err) {
        console.error('Add Assignment Error:', err);
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(400).send('Error: This assignment already exists.');
        }
        res.status(500).send('Error assigning teacher');
    }
};

const deleteAssignment = (req, res) => {
    const { id } = req.params;
    try {
        db.prepare('DELETE FROM subject_assignments WHERE id = ?').run(id);
        res.redirect('/academics');
    } catch (err) {
        console.error('Delete Assignment Error:', err);
        res.status(500).send('Error deleting assignment');
    }
};


module.exports = {
    getAcademicDashboard,
    addClass,
    deleteClass,
    addSubject,
    editSubjectForm,
    updateSubject,
    deleteSubject,
    addAssignment,
    deleteAssignment
};
