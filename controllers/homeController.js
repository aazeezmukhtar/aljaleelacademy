const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../database.sqlite'));

const getDashboard = (req, res) => {
    try {
        const user = req.session.staff;
        const today = new Date().toISOString().split('T')[0];

        if (user.role === 'Admin') {
            // --- ADMIN VIEW (Existing Logic) ---
            const totalStudents = db.prepare("SELECT COUNT(*) as count FROM students WHERE status = 'active'").get().count;
            const activeStaffCount = db.prepare("SELECT COUNT(*) as count FROM staff").get().count;

            const attendanceData = db.prepare(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) as present
                FROM attendance 
                WHERE date = ?
            `).get(today);

            const attendance = attendanceData.total > 0
                ? ((attendanceData.present / attendanceData.total) * 100).toFixed(1) + '%'
                : 'N/A';

            const feeStats = db.prepare(`
                SELECT 
                    SUM(total_amount) as expected,
                    SUM(paid_amount) as collected
                FROM student_fees
            `).get();
            const revenuePercentage = feeStats.expected > 0 
                ? Math.round((feeStats.collected / feeStats.expected) * 100) 
                : 0;

            const totalSubjects = db.prepare("SELECT COUNT(*) as count FROM subjects").get().count;

            const genderStats = db.prepare(`
                SELECT gender, COUNT(*) as count 
                FROM students 
                WHERE status = 'active' 
                GROUP BY gender
            `).all();
            const genderSummary = { Male: 0, Female: 0 };
            genderStats.forEach(g => {
                if (g.gender === 'Male' || g.gender === 'Female') {
                    genderSummary[g.gender] = g.count;
                }
            });

            const recentEnrollments = db.prepare(`
                SELECT s.first_name, s.last_name, c.name as class_name, s.admission_date
                FROM students s
                LEFT JOIN classes c ON s.current_class_id = c.id
                ORDER BY s.admission_date DESC
                LIMIT 5
            `).all();

            // 5. Announcements
            const announcements = db.prepare(`
                SELECT * FROM announcements 
                ORDER BY created_at DESC LIMIT 10
            `).all();

            // 6. Upcoming Events (New)
            const upcomingEvents = db.prepare(`
                SELECT * FROM term_events 
                WHERE event_date >= ? 
                ORDER BY event_date ASC LIMIT 3
            `).all(today);

            return res.render('dashboard', {
                title: 'Nexus SIS - Admin Dashboard',
                role: 'Admin',
                stats: {
                    totalStudents,
                    activeStaff: activeStaffCount,
                    attendance,
                    revenuePercentage,
                    totalSubjects,
                    genderSummary
                },
                recentEnrollments,
                announcements,
                upcomingEvents
            });
        } else {
            // --- STAFF / TEACHER VIEW (Scoped) ---
            // 1. Assigned Classes
            const assignedClasses = db.prepare(`
                SELECT DISTINCT c.id, c.name 
                FROM class_assignments ca
                JOIN classes c ON ca.class_id = c.id
                WHERE ca.staff_id = ?
            `).all(user.id);

            // 2. Assigned Subjects
            const assignedSubjects = db.prepare(`
                SELECT DISTINCT s.id, s.name, c.name as class_name
                FROM subject_assignments sa
                JOIN subjects s ON sa.subject_id = s.id
                JOIN classes c ON sa.class_id = c.id
                WHERE sa.teacher_id = ?
            `).all(user.id);

            // 3. Students in assigned classes
            const myStudentsCount = db.prepare(`
                SELECT COUNT(*) as count 
                FROM students 
                WHERE current_class_id IN (
                    SELECT class_id FROM class_assignments WHERE staff_id = ?
                ) AND status = 'active'
            `).get(user.id).count;

            // 4. Attendance Today (for assigned classes)
            const myAttendanceData = db.prepare(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) as present
                FROM attendance 
                WHERE date = ? AND class_id IN (
                    SELECT class_id FROM class_assignments WHERE staff_id = ?
                )
            `).get(today, user.id);

            const myAttendance = myAttendanceData.total > 0
                ? ((myAttendanceData.present / myAttendanceData.total) * 100).toFixed(1) + '%'
                : 'Pending';

            // 5. Announcements (Scoped or General)
            const announcements = db.prepare(`
                SELECT * FROM announcements 
                WHERE is_published = 1 AND (target_role = ? OR target_role = 'All')
                ORDER BY created_at DESC LIMIT 5
            `).all(user.role);

            // 6. Upcoming Events (New)
            const upcomingEvents = db.prepare(`
                SELECT * FROM term_events 
                WHERE event_date >= ? 
                ORDER BY event_date ASC LIMIT 3
            `).all(today);

            return res.render('dashboard_staff', {
                title: 'Nexus SIS - Staff Dashboard',
                role: user.role,
                stats: {
                    assignedClasses: assignedClasses.length,
                    assignedSubjects: assignedSubjects.length,
                    myStudents: myStudentsCount,
                    attendanceToday: myAttendance
                },
                assignedClasses,
                assignedSubjects,
                announcements,
                upcomingEvents
            });
        }
    } catch (err) {
        console.error('Dashboard Data Error:', err);
        res.status(500).send('Internal Server Error');
    }
};


module.exports = { getDashboard };
