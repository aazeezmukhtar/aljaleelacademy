const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../database.sqlite'));

const getAuditLogs = (req, res) => {
    const user = req.session.staff;
    if (user.role !== 'Admin') {
        return res.status(403).send('Access Denied');
    }
    try {
        const logs = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100').all();
        res.render('settings/audit', { title: 'Audit Logs', logs });
    } catch (err) {
        console.error('Audit Log Error:', err);
        res.status(500).send('Database Error');
    }
};

const getAcademicReports = (req, res) => {
    const user = req.session.staff;
    try {
        let classPerf;
        if (user.role === 'Admin') {
            classPerf = db.prepare(`
                SELECT c.name as class_name, AVG(r.total) as avg_score, COUNT(r.id) as result_count
                FROM classes c
                JOIN students s ON c.id = s.current_class_id
                JOIN results r ON s.id = r.student_id
                GROUP BY c.id
            `).all();
        } else {
            classPerf = db.prepare(`
                SELECT c.name as class_name, AVG(r.total) as avg_score, COUNT(r.id) as result_count
                FROM classes c
                LEFT JOIN class_assignments ca ON c.id = ca.class_id AND ca.staff_id = ?
                LEFT JOIN subject_assignments sa ON c.id = sa.class_id AND sa.teacher_id = ?
                JOIN students s ON c.id = s.current_class_id
                JOIN results r ON s.id = r.student_id
                WHERE c.form_teacher_id = ? OR ca.staff_id IS NOT NULL OR sa.teacher_id IS NOT NULL
                GROUP BY c.id
            `).all(user.id, user.id, user.id);
        }
        res.render('reports/academic', { title: 'Academic Reports', classPerf });
    } catch (err) {
        console.error('Academic Report Error:', err);
        res.status(500).send('Database Error');
    }
};

const getStudentReports = (req, res) => {
    try {
        const totalStudents = db.prepare("SELECT count(*) as count FROM students WHERE status='active'").get();
        const genderDist = db.prepare("SELECT gender, count(*) as count FROM students WHERE status='active' GROUP BY gender").all();
        const classDist = db.prepare(`
            SELECT c.name, count(s.id) as count
            FROM students s
            JOIN classes c ON s.current_class_id = c.id
            WHERE s.status='active'
            GROUP BY c.id
        `).all();
        const recentAdmissions = db.prepare(`
            SELECT first_name, last_name, admission_number, admission_date 
            FROM students 
            WHERE status='active' 
            ORDER BY admission_date DESC 
            LIMIT 5
        `).all();
        res.render('reports/students', {
            title: 'Student Demographics',
            stats: { total: totalStudents.count, gender: genderDist, classes: classDist, recent: recentAdmissions }
        });
    } catch (err) {
        console.error('Student Report Error:', err);
        res.status(500).send('Database Error');
    }
};

const getAttendanceReports = (req, res) => {
    try {
        const attendanceStats = db.prepare(`
            SELECT c.name as class_name, 
                   count(CASE WHEN a.status='Present' THEN 1 END) as present_count,
                   count(a.id) as total_records
            FROM attendance a
            JOIN classes c ON a.class_id = c.id
            GROUP BY c.id
        `).all();
        res.render('reports/attendance', { title: 'Attendance Reports', stats: attendanceStats });
    } catch (err) {
        console.error('Attendance Report Error:', err);
        res.status(500).send('Database Error');
    }
};

const getFeeReports = (req, res) => {
    try {
        const feeStats = db.prepare(`
            SELECT 
                SUM(total_amount) as expected, 
                SUM(paid_amount) as collected, 
                SUM(total_amount - paid_amount) as outstanding 
            FROM student_fees
        `).get();
        const categoryStats = db.prepare(`
             SELECT fc.name, SUM(sf.total_amount) as expected, SUM(sf.paid_amount) as collected
             FROM student_fees sf
             JOIN fee_categories fc ON sf.fee_category_id = fc.id
             GROUP BY fc.id
        `).all();

        const debtors = db.prepare(`
            SELECT s.first_name, s.last_name, s.admission_number, c.name as class_name,
                   SUM(sf.total_amount) as total_owed,
                   SUM(sf.paid_amount) as total_paid,
                   SUM(sf.total_amount - sf.paid_amount) as outstanding
            FROM student_fees sf
            JOIN students s ON sf.student_id = s.id
            LEFT JOIN classes c ON s.current_class_id = c.id
            GROUP BY sf.student_id
            HAVING outstanding > 0
            ORDER BY outstanding DESC
        `).all();

        res.render('reports/fees', {
            title: 'Fee Collection Reports',
            overall: feeStats,
            categories: categoryStats,
            debtors
        });
    } catch (err) {
        console.error('Fee Report Error:', err);
        res.status(500).send('Database Error');
    }
};

const getStaffReports = (req, res) => {
    try {
        const staffList = db.prepare(`
            SELECT s.first_name, s.last_name, s.designation, count(sa.id) as subjects_count
            FROM staff s
            LEFT JOIN subject_assignments sa ON s.id = sa.teacher_id
            WHERE s.status != 'inactive'
            GROUP BY s.id
        `).all();
        res.render('reports/staff', { title: 'Staff Reports', staff: staffList });
    } catch (err) {
        console.error('Staff Report Error:', err);
        res.status(500).send('Database Error');
    }
};

const getHealthReports = (req, res) => {
    try {
        const students = db.prepare(`
            SELECT s.first_name, s.last_name, s.admission_number, s.parent_phone, s.parent_address, c.name as class_name
            FROM students s
            LEFT JOIN classes c ON s.current_class_id = c.id
            WHERE s.status='active'
        `).all();
        res.render('reports/health', { title: 'Health & Emergency Contacts', students });
    } catch (err) {
        console.error('Health Report Error:', err);
        res.status(500).send('Database Error');
    }
};

module.exports = {
    getAuditLogs,
    getAcademicReports,
    getStudentReports,
    getAttendanceReports,
    getFeeReports,
    getStaffReports,
    getHealthReports
};
