const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../database.sqlite'));

const getSettings = () => {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    return settings;
};

exports.getDashboard = (req, res) => {
    const studentId = req.session.student.id;
    const school = getSettings();

    // Fetch latest results
    const results = db.prepare(`
        SELECT session, term, COUNT(*) as subjects_taken
        FROM results
        WHERE student_id = ? AND status IN ('approved', 'published')
        GROUP BY session, term
        ORDER BY session DESC, term DESC
    `).all(studentId);

    // Fetch fee payments
    const payments = db.prepare(`
        SELECT p.*, fc.session, fc.term 
        FROM payments p
        JOIN student_fees sf ON p.student_fee_id = sf.id
        JOIN fee_categories fc ON sf.fee_category_id = fc.id
        WHERE p.student_id = ?
        ORDER BY p.payment_date DESC
        LIMIT 5
    `).all(studentId);

    // Fetch latest announcements
    const announcements = db.prepare(`
        SELECT * FROM announcements 
        WHERE is_published = 1 AND (target_role = 'Students' OR target_role = 'All')
        ORDER BY created_at DESC LIMIT 3
    `).all();

    // Fetch latest class posts (general + targeted)
    const classId = req.session.student.class_id;
    const classPosts = classId ? db.prepare('SELECT cp.*, s.first_name, s.last_name FROM class_posts cp JOIN staff s ON cp.teacher_id = s.id WHERE cp.class_id = ? AND (cp.student_id IS NULL OR cp.student_id = ?) ORDER BY cp.created_at DESC LIMIT 5').all(classId, studentId) : [];

    const individualMessagesCount = db.prepare('SELECT COUNT(*) as c FROM class_posts WHERE student_id = ?').get(studentId).c;
    
    // Fee Stats for Progress Bar
    const feeStats = db.prepare(`
        SELECT 
            SUM(total_amount) as expected,
            SUM(paid_amount) as collected
        FROM student_fees
        WHERE student_id = ?
    `).get(studentId);
    const feeProgress = feeStats.expected > 0 ? Math.round((feeStats.collected / feeStats.expected) * 100) : 0;
    const feeBalance = (feeStats.expected || 0) - (feeStats.collected || 0);
    // Fetch upcoming events
    const upcomingEvents = db.prepare(`
        SELECT * FROM term_events 
        WHERE event_date >= date('now') 
        ORDER BY event_date ASC LIMIT 5
    `).all();

    const studentObj = db.prepare('SELECT s.*, c.name as class_name FROM students s LEFT JOIN classes c ON s.current_class_id = c.id WHERE s.id = ?').get(studentId);

    res.render('portal/index', {
        title: 'Student Dashboard',
        path: '/portal',
        school,
        results,
        payments,
        announcements,
        classPosts,
        upcomingEvents: upcomingEvents || [],
        student: studentObj,
        individualMessagesCount,
        feeProgress,
        feeBalance,
        currentTerm: school.current_term || 'First',
        currentSession: school.current_session || '2025/2026',
        error: req.query.error
    });
};

exports.getResults = (req, res) => {
    res.redirect('/portal'); // Or render a dedicated list of previous terms
};

exports.viewTermlyResult = (req, res) => {
    const term = req.query.term;
    const session = req.query.session;
    const approved = db.prepare(`SELECT COUNT(*) as c FROM results WHERE student_id = ? AND term = ? AND session = ? AND status IN ('approved', 'published')`).get(req.session.student.id, term, session).c;
    if(approved === 0) {
        return res.redirect('/portal?error=Results not yet published by the Administrator.');
    }
    req.params.student_id = req.session.student.id;
    const resultController = require('./resultController');
    resultController.getReportCard(req, res);
};

exports.viewCumulativeResult = (req, res) => {
    const session = req.query.session;
    const approved = db.prepare(`SELECT COUNT(*) as c FROM results WHERE student_id = ? AND session = ? AND status IN ('approved', 'published')`).get(req.session.student.id, session).c;
    if(approved === 0) {
        return res.redirect('/portal?error=Results not yet published by the Administrator.');
    }
    req.params.student_id = req.session.student.id;
    const resultController = require('./resultController');
    resultController.getCumulativeReport(req, res);
};

exports.getChangePassword = (req, res) => {
    res.render('portal/change_password', {
        title: 'Change Password - Scholar Portal',
        studentUser: req.session.student,
        error: req.query.error,
        success: req.query.success
    });
};

exports.postChangePassword = (req, res) => {
    const { current_password, new_password, confirm_password } = req.body;
    const studentId = req.session.student.id;

    if (new_password !== confirm_password) {
        return res.redirect('/portal/change-password?error=New passwords do not match');
    }

    try {
        const student = db.prepare('SELECT password FROM students WHERE id = ?').get(studentId);

        if (student.password !== current_password) {
            return res.redirect('/portal/change-password?error=Incorrect current password');
        }

        db.prepare('UPDATE students SET password = ? WHERE id = ?').run(new_password, studentId);
        
        // Let's destroy session so they login with new credentials (or just redirect)
        res.redirect('/portal/change-password?success=Password updated successfully');
    } catch (err) {
        console.error('Portal Change Password Error:', err);
        res.redirect('/portal/change-password?error=Database error occurred');
    }
};

exports.getCalendar = (req, res) => {
    try {
        const events = db.prepare('SELECT * FROM term_events ORDER BY event_date ASC').all();
        res.render('portal/calendar', {
            title: 'School Calendar',
            student: req.session.student,
            events,
            school: getSettings()
        });
    } catch (err) {
        console.error('Portal Calendar Error:', err);
        res.status(500).send('Database Error');
    }
};

exports.viewAnnouncement = (req, res) => {
    try {
        const id = req.params.id;
        const announcement = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
        
        if (!announcement) {
            return res.redirect('/portal?error=Announcement not found');
        }

        res.render('portal/announcement', {
            title: announcement.title,
            student: req.session.student,
            school: getSettings(),
            announcement
        });
    } catch (err) {
        console.error('Portal View Announcement Error:', err);
        res.status(500).send('Database Error');
    }
};
