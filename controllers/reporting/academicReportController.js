const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../../database.sqlite'));

const getAcademicDashboard = (req, res) => {
    const user = req.session.staff;
    const stats = {
        total_results: db.prepare("SELECT COUNT(*) as count FROM results").get().count,
        subjects: db.prepare("SELECT COUNT(*) as count FROM subjects").get().count,
        classes: db.prepare("SELECT COUNT(*) as count FROM classes").get().count
    };

    res.render('reports/academic/index', {
        title: 'Academic Reports Dashboard',
        stats,
        user
    });
};

const getBroadsheet = (req, res) => {
    const user = req.session.staff;
    const { class_id, term, session } = req.query;

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

    let reportData = null;
    let subjects = [];

    if (class_id && term && session) {
        const clazz = db.prepare('SELECT name FROM classes WHERE id = ?').get(class_id);

        // All subjects with results for this class/term/session
        subjects = db.prepare(`
            SELECT DISTINCT s.id, s.name
            FROM subjects s
            JOIN results r ON s.id = r.subject_id
            JOIN students st ON r.student_id = st.id
            WHERE st.current_class_id = ? AND r.term = ? AND r.session = ?
            ORDER BY s.name
        `).all(class_id, term, session);

        // All active students in the class
        const students = db.prepare(`
            SELECT id, first_name, last_name, admission_number
            FROM students
            WHERE current_class_id = ? AND status = 'active'
            ORDER BY last_name, first_name
        `).all(class_id);

        // All results for this class/term/session
        const allResults = db.prepare(`
            SELECT r.student_id, r.subject_id, r.total, r.grade
            FROM results r
            JOIN students st ON r.student_id = st.id
            WHERE st.current_class_id = ? AND r.term = ? AND r.session = ?
        `).all(class_id, term, session);

        // Build result lookup map: resultMap[student_id][subject_id]
        const resultMap = {};
        allResults.forEach(r => {
            if (!resultMap[r.student_id]) resultMap[r.student_id] = {};
            resultMap[r.student_id][r.subject_id] = { total: r.total, grade: r.grade };
        });

        // Augment students with results + totals
        const studentsWithResults = students.map(st => {
            const results = resultMap[st.id] || {};
            const scores = Object.values(results).map(r => r.total);
            const total_score = scores.reduce((a, b) => a + b, 0);
            const average = scores.length > 0 ? (total_score / scores.length).toFixed(1) : '-';
            return { ...st, results, total_score, average };
        });

        // Sort by total score descending
        studentsWithResults.sort((a, b) => b.total_score - a.total_score);

        reportData = {
            class_name: clazz ? clazz.name : 'Unknown Class',
            term,
            session,
            students: studentsWithResults
        };
    }

    res.render('reports/academic/broadsheet', {
        title: 'Master Broadsheet',
        classes,
        subjects,
        reportData,
        user,
        query: { class_id, term, session }
    });
};

const getSubjectAnalysis = (req, res) => {
    const user = req.session.staff;
    const { class_id, term, session } = req.query;

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

    res.render('reports/academic/analysis', {
        title: 'Subject Analysis',
        classes,
        user,
        query: { class_id, term, session }
    });
};

const getTopPerformers = (req, res) => {
    const user = req.session.staff;
    const { class_id, term, session, limit } = req.query;

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

    let topStudents = [];
    if (class_id && term && session) {
        topStudents = db.prepare(`
            SELECT 
                s.first_name, s.last_name, s.admission_number,
                c.name as class_name,
                COUNT(r.id) as subjects_sat,
                SUM(r.total) as total_score,
                AVG(r.total) as average_score
            FROM students s
            JOIN results r ON s.id = r.student_id
            JOIN classes c ON s.current_class_id = c.id
            WHERE s.current_class_id = ? AND r.term = ? AND r.session = ?
            GROUP BY s.id
            ORDER BY average_score DESC
            LIMIT ?
        `).all(class_id, term, session, limit || 10);
    }

    res.render('reports/academic/top', {
        title: 'Top Performers',
        classes,
        topStudents,
        user,
        query: { class_id, term, session, limit: limit || 10 }
    });
};

module.exports = {
    getAcademicDashboard,
    getBroadsheet,
    getSubjectAnalysis,
    getTopPerformers
};
