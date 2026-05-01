const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../database.sqlite'));
const { logAction } = require('../utils/logger');
const { generateUniqueID } = require('../utils/idHelper');

const getStudents = (req, res) => {
    const user = req.session.staff;
    const { search, class_id, status } = req.query;

    let classes;
    if (user.role === 'Admin') {
        classes = db.prepare('SELECT * FROM classes WHERE id != 0').all();
    } else {
        classes = db.prepare(`
            SELECT DISTINCT c.* 
            FROM classes c
            LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
            LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
            WHERE c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL
            ORDER BY c.name ASC
        `).all(user.id, user.id, user.id);
    }

    let query = `
        SELECT s.*, c.name as class_name 
        FROM students s
        LEFT JOIN classes c ON s.current_class_id = c.id
        WHERE 1=1
    `;
    const params = [];

    let myClasses = [];
    if (user.role !== 'Admin') {
        myClasses = classes.map(c => c.id);
        if (myClasses.length > 0) {
            query += ` AND s.current_class_id IN (${myClasses.join(',')})`;
        } else {
            query += ` AND s.current_class_id = -1`; // Return none
        }
    }

    if (search) {
        query += ` AND (s.first_name LIKE ? OR s.last_name LIKE ? OR s.admission_number LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (class_id) {
        if (user.role === 'Admin' || myClasses.includes(parseInt(class_id))) {
            query += ` AND s.current_class_id = ?`;
            params.push(class_id);
        } else if (user.role !== 'Admin') {
            query += ` AND s.current_class_id = -1`; 
        }
    }

    if (status) {
        query += ` AND s.status = ?`;
        params.push(status);
    }

    query += ` ORDER BY s.last_name ASC, s.first_name ASC`;

    try {
        const students = db.prepare(query).all(...params);

        res.render('students/index', {
            title: 'Student Management',
            students,
            classes,
            user,
            filters: { search, class_id: class_id || '', status: status || '' }
        });
    } catch (err) {
        console.error('Fetch Students Error:', err);
        res.status(500).send('Database Error');
    }
};

const getEnrollmentForm = (req, res) => {
    try {
        const user = req.session.staff;
        let classes;
        if (user.role === 'Admin') {
            classes = db.prepare('SELECT * FROM classes').all();
        } else {
            classes = db.prepare(`
                SELECT DISTINCT c.* 
                FROM classes c
                LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
                LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
                WHERE c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL
                ORDER BY c.name ASC
            `).all(user.id, user.id, user.id);
        }
        res.render('students/enroll', {
            title: 'Enroll New Student',
            classes
        });
    } catch (err) {
        console.error('Fetch Metadata Error:', err);
        res.status(500).send('Database Error');
    }
};

const enrollStudent = (req, res) => {
    const {
        first_name,
        last_name,
        gender,
        dob,
        current_class_id,
        parent_phone,
        parent_address
    } = req.body;
    
    const admission_number = generateUniqueID();
    const passport_photo_path = req.file ? `/uploads/${req.file.filename}` : null;

    try {
        const insert = db.prepare(`
            INSERT INTO students (first_name, last_name, gender, dob, current_class_id, parent_phone, parent_address, admission_number, passport_photo_path, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
        `);
        insert.run(first_name, last_name, gender, dob, current_class_id, parent_phone, parent_address, admission_number, passport_photo_path);
        
        logAction(req.session.staff.id, 'ENROLL_STUDENT', 'STUDENT', { first_name, last_name, class_id: current_class_id }, req.ip);
        res.redirect('/students?success=true');
    } catch (err) {
        console.error('Enroll Error:', err);
        res.redirect('/students/enroll?error=Enrollment failed');
    }
};

const getStudentProfile = (req, res) => {
    const { id } = req.params;
    try {
        const student = db.prepare(`
            SELECT s.*, c.name as class_name 
            FROM students s 
            LEFT JOIN classes c ON s.current_class_id = c.id 
            WHERE s.id = ?
        `).get(id);

        if (!student) return res.status(404).send('Student not found');

        // Fee summary
        const feeRow = db.prepare(`
            SELECT COALESCE(SUM(total_amount), 0) as total_owed, COALESCE(SUM(paid_amount), 0) as total_paid
            FROM student_fees WHERE student_id = ?
        `).get(id);
        const fees = feeRow || { total_owed: 0, total_paid: 0 };

        // Health record
        const health = db.prepare('SELECT * FROM student_health WHERE student_id = ?').get(id) || {};

        // Academic terms with results
        const academicTerms = db.prepare(`
            SELECT DISTINCT term, session FROM results WHERE student_id = ? ORDER BY session DESC, term ASC
        `).all(id);

        const success = req.query.success || null;
        const error = req.query.error || null;

        res.render('students/view', {
            title: `Student Profile`,
            student,
            fees,
            health,
            academicTerms,
            success,
            error
        });
    } catch (err) {
        console.error('Fetch Profile Error:', err);
        res.status(500).send('Database Error');
    }
};

const getEditForm = (req, res) => {
    const { id } = req.params;
    const user = req.session.staff;
    try {
        const student = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
        let classes;
        if (user.role === 'Admin') {
            classes = db.prepare('SELECT * FROM classes').all();
        } else {
            classes = db.prepare(`
                SELECT DISTINCT c.* 
                FROM classes c
                LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
                LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
                WHERE c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL
                ORDER BY c.name ASC
            `).all(user.id, user.id, user.id);
        }
        res.render('students/edit', {
            title: `Edit Student: ${student.first_name} ${student.last_name}`,
            student,
            classes
        });
    } catch (err) {
        console.error('Fetch Edit Form Error:', err);
        res.status(500).send('Database Error');
    }
};

const updateStudent = (req, res) => {
    const { id } = req.params;
    const {
        first_name,
        last_name,
        gender,
        dob,
        admission_number,
        current_class_id,
        parent_phone,
        parent_address,
        status
    } = req.body;

    let passport_photo_path = req.body.existing_photo;
    if (req.file) {
        passport_photo_path = `/uploads/${req.file.filename}`;
    }

    try {
        const update = db.prepare(`
            UPDATE students SET
                first_name = ?, last_name = ?, gender = ?, dob = ?, 
                admission_number = ?, current_class_id = ?, 
                parent_phone = ?, parent_address = ?, passport_photo_path = ?, status = ?
            WHERE id = ?
        `);

        update.run(
            first_name, last_name, gender, dob,
            admission_number || null,
            current_class_id || null,
            parent_phone || null,
            parent_address || null,
            passport_photo_path,
            status,
            id
        );

        res.json({ success: true, message: 'Student updated successfully.' });

        logAction(req.session.staff.id, 'UPDATE_STUDENT', 'STUDENT', {
            id, first_name, last_name, admission_number
        }, req.ip);
    } catch (err) {
        console.error('Update Student Error:', err);
        res.status(500).json({ success: false, message: 'Failed to update student.' });
    }
};

const saveHealthRecord = (req, res) => {
    const {
        student_id, blood_group, genotype, allergies,
        medical_conditions, emergency_contact_name, emergency_contact_phone
    } = req.body;

    try {
        const stmt = db.prepare(`
            INSERT INTO student_health (
                student_id, blood_group, genotype, allergies, 
                medical_conditions, emergency_contact_name, emergency_contact_phone
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(student_id) DO UPDATE SET
                blood_group = excluded.blood_group,
                genotype = excluded.genotype,
                allergies = excluded.allergies,
                medical_conditions = excluded.medical_conditions,
                emergency_contact_name = excluded.emergency_contact_name,
                emergency_contact_phone = excluded.emergency_contact_phone
        `);

        stmt.run(
            student_id, blood_group, genotype, allergies,
            medical_conditions, emergency_contact_name, emergency_contact_phone
        );

        res.redirect(`/students/view/${student_id}?success=Health record updated`);

        logAction(req.session.staff.id, 'UPDATE_HEALTH', 'HEALTH', {
            student_id
        }, req.ip);
    } catch (err) {
        console.error('Save Health Record Error:', err);
        res.status(500).send('Database Error');
    }
};

module.exports = {
    enrollStudent, getStudents, getEnrollmentForm,
    getStudentProfile, getEditForm, updateStudent, saveHealthRecord
};
