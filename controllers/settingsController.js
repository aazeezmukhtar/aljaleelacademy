const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const db = new Database(path.join(__dirname, '../database.sqlite'));

// Get Settings Page
const getSettingsPage = (req, res) => {
    try {
        const settingsArr = db.prepare('SELECT * FROM settings').all();
        const settings = {};
        settingsArr.forEach(s => settings[s.key] = s.value);

        res.render('settings', {
            title: 'School Settings',
            settings,
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) {
        console.error('Settings Page Error:', err);
        res.status(500).send('Database Error');
    }
};

// Update Settings
const updateSettings = (req, res) => {
    const { school_name, school_motto, primary_color, secondary_color, address, phone, next_term_start_date, show_watermark } = req.body;
    const logoFile = req.file;

    const updates = [
        { key: 'school_name', value: school_name },
        { key: 'school_motto', value: school_motto },
        { key: 'primary_color', value: primary_color },
        { key: 'secondary_color', value: secondary_color },
        { key: 'address', value: address },
        { key: 'phone', value: phone },
        { key: 'next_term_start_date', value: next_term_start_date },
        { key: 'show_watermark', value: show_watermark === 'true' ? 'true' : 'false' }
    ];

    if (logoFile) {
        // In a real app, delete old logo if exists
        const logoPath = '/uploads/' + logoFile.filename;
        updates.push({ key: 'school_logo', value: logoPath });
    }

    try {
        const insert = db.prepare(`
            INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `);

        const transaction = db.transaction((items) => {
            for (const item of items) {
                if (item.value) { // Only update if value is provided
                    insert.run(item.key, item.value);
                }
            }
        });

        transaction(updates);

        res.redirect('/settings?success=Settings updated successfully');
    } catch (err) {
        console.error('Update Settings Error:', err);
        res.redirect('/settings?error=Failed to update settings');
    }
};

module.exports = { getSettingsPage, updateSettings };
