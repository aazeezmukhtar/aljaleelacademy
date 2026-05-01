const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../database.sqlite'));

exports.getIndex = (req, res) => {
    const announcements = db.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all();
    
    res.render('announcements/index', {
        title: 'Announcement Management',
        path: '/announcements',
        announcements
    });
};

exports.createAnnouncement = (req, res) => {
    res.render('announcements/form', {
        title: 'Create Announcement',
        path: '/announcements'
    });
};

exports.storeAnnouncement = (req, res) => {
    try {
        const { title, content, target_role, is_published, type, event_date } = req.body;
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();
        const image_path = req.file ? req.file.filename : null;

        db.prepare(`
            INSERT INTO announcements (title, slug, content, target_role, image_path, is_published, type, event_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            title, 
            slug, 
            content, 
            target_role || 'All', 
            image_path, 
            is_published === '1' ? 1 : 0,
            type || 'Announcement',
            (type === 'Event' && event_date) ? event_date : null
        );

        res.redirect('/announcements?success=Announcement created successfully');
    } catch (e) {
        console.error(e);
        res.redirect('/announcements?error=Failed to create announcement');
    }
};

exports.toggleAnnouncement = (req, res) => {
    db.prepare(`UPDATE announcements SET is_published = CASE WHEN is_published = 1 THEN 0 ELSE 1 END WHERE id = ?`).run(req.params.id);
    res.redirect('/announcements');
};

exports.deleteAnnouncement = (req, res) => {
    db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
    res.redirect('/announcements?success=Announcement deleted');
};

exports.viewAnnouncement = (req, res) => {
    const id = req.params.id;
    try {
        const announcement = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
        if (!announcement) return res.status(404).send('Announcement not found');
        
        res.render('announcements/view', {
            title: announcement.title,
            announcement,
            user: req.session.staff || req.session.student
        });
    } catch (err) {
        console.error('View Announcement Error:', err);
        res.status(500).send('Database Error');
    }
};

