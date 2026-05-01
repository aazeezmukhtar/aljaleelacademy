const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../database.sqlite'));

exports.getCalendar = (req, res) => {
    try {
        const events = db.prepare('SELECT * FROM term_events ORDER BY event_date ASC').all();
        res.render('calendar/index', {
            title: 'School Calendar',
            events,
            user: req.session.staff || req.session.student
        });
    } catch (err) {
        console.error('Calendar Fetch Error:', err);
        res.status(500).send('Database Error');
    }
};

exports.getManageCalendar = (req, res) => {
    const user = req.session.staff;
    if (!user || user.role !== 'Admin') return res.status(403).send('Access Denied');
    
    try {
        const events = db.prepare('SELECT * FROM term_events ORDER BY event_date DESC').all();
        res.render('calendar/manage', {
            title: 'Manage Calendar',
            events
        });
    } catch (err) {
        console.error('Calendar Manage Error:', err);
        res.status(500).send('Database Error');
    }
};

exports.createEvent = (req, res) => {
    const { title, description, event_date, type, session, term } = req.body;
    const user = req.session.staff;
    if (!user || user.role !== 'Admin') return res.status(403).send('Access Denied');

    try {
        db.prepare(`
            INSERT INTO term_events (title, description, event_date, type, session, term)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(title, description, event_date, type, session, term);
        res.redirect('/calendar/manage?success=Event added');
    } catch (err) {
        console.error('Create Event Error:', err);
        res.redirect('/calendar/manage?error=Failed to add event');
    }
};

exports.deleteEvent = (req, res) => {
    const user = req.session.staff;
    if (!user || user.role !== 'Admin') return res.status(403).send('Access Denied');

    try {
        db.prepare('DELETE FROM term_events WHERE id = ?').run(req.params.id);
        res.redirect('/calendar/manage?success=Event deleted');
    } catch (err) {
        console.error('Delete Event Error:', err);
        res.redirect('/calendar/manage?error=Failed to delete event');
    }
};
