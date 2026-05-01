const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../database.sqlite'));

const getSetup = (req, res) => {
    try {
        const classes = db.prepare('SELECT * FROM classes').all();
        const feeCategories = db.prepare(`
            SELECT fc.*, c.name as class_name 
            FROM fee_categories fc
            LEFT JOIN classes c ON fc.class_id = c.id
            ORDER BY fc.session DESC, fc.term
        `).all();

        res.render('fees/setup', {
            title: 'Fee Structure Setup',
            classes,
            feeCategories
        });
    } catch (err) {
        console.error('Fee Setup Error:', err);
        res.status(500).send('Database Error');
    }
};

const addFeeCategory = (req, res) => {
    const { name, amount, class_id, session, term } = req.body;
    try {
        db.prepare(`
            INSERT INTO fee_categories (name, amount, class_id, session, term)
            VALUES (?, ?, ?, ?, ?)
        `).run(name, amount, class_id, session, term);
        res.redirect('/fees/setup');
    } catch (err) {
        console.error('Add Fee Category Error:', err);
        res.status(500).send('Error adding fee category');
    }
};

const getFeeManager = (req, res) => {
    const { class_id } = req.query;
    const user = req.session.staff;
    try {
        if (user.role === 'Admin') {
            classes = db.prepare('SELECT * FROM classes ORDER BY name').all();
        } else {
            classes = db.prepare(`
                SELECT DISTINCT c.* FROM classes c
                JOIN class_assignments ca ON c.id = ca.class_id
                WHERE ca.staff_id = ?
                ORDER BY c.name
            `).all(user.id);
        }

        let students = [];
        if (class_id) {
            // Access control check
            if (user.role !== 'Admin') {
                const isAssigned = classes.find(c => String(c.id) === String(class_id));
                if (!isAssigned) return res.redirect('/fees/manager?error=Unauthorized Access');
            }

            students = db.prepare(`
                SELECT s.id, s.first_name, s.last_name, s.admission_number,
                       COALESCE(SUM(sf.total_amount), 0) as total_owed,
                       COALESCE(SUM(sf.paid_amount), 0) as total_paid
                FROM students s
                LEFT JOIN student_fees sf ON s.id = sf.student_id
                WHERE s.current_class_id = ? AND s.status = 'active'
                GROUP BY s.id
                ORDER BY s.last_name, s.first_name
            `).all(class_id);
        }

        res.render('fees/manager', {
            title: 'Fee Management',
            classes,
            students,
            filters: { class_id }
        });
    } catch (err) {
        console.error('Fee Manager Error:', err);
        res.status(500).send('Database Error');
    }
};

const getStudentFees = (req, res) => {
    const { student_id } = req.params;
    const user = req.session.staff;
    try {
        const student = db.prepare('SELECT * FROM students WHERE id = ?').get(student_id);
        if (!student) return res.status(404).send('Student not found');

        // Access control check
        if (user.role !== 'Admin') {
            const isAssigned = db.prepare(`
                SELECT id FROM class_assignments WHERE staff_id = ? AND class_id = ?
            `).get(user.id, student.current_class_id);
            if (!isAssigned) return res.redirect('/fees/manager?error=Unauthorized Access to this student');
        }

        const fees = db.prepare(`
            SELECT sf.*, fc.name as fee_name, fc.amount as base_amount
            FROM student_fees sf
            JOIN fee_categories fc ON sf.fee_category_id = fc.id
            WHERE sf.student_id = ?
        `).all(student_id);

        const availableFees = db.prepare(`
            SELECT * FROM fee_categories 
            WHERE (class_id = ? OR class_id = 0)
            AND id NOT IN (SELECT fee_category_id FROM student_fees WHERE student_id = ?)
        `).all(student.current_class_id, student_id);

        res.render('fees/student-details', {
            title: 'Student Fee Details',
            student,
            fees,
            availableFees
        });
    } catch (err) {
        console.error('Student Fees Error:', err);
        res.status(500).send('Database Error');
    }
};

const assignFee = (req, res) => {
    const { student_id, fee_category_id } = req.body;
    try {
        const fee = db.prepare('SELECT amount FROM fee_categories WHERE id = ?').get(fee_category_id);
        db.prepare(`
            INSERT INTO student_fees (student_id, fee_category_id, total_amount)
            VALUES (?, ?, ?)
        `).run(student_id, fee_category_id, fee.amount);
        res.redirect(`/fees/student/${student_id}`);
    } catch (err) {
        console.error('Assign Fee Error:', err);
        res.status(500).send('Error assigning fee');
    }
};

const getPayForm = (req, res) => {
    const { student_fee_id } = req.params;
    try {
        const fee = db.prepare(`
            SELECT sf.*, fc.name as fee_name, s.first_name, s.last_name, s.id as student_id
            FROM student_fees sf
            JOIN fee_categories fc ON sf.fee_category_id = fc.id
            JOIN students s ON sf.student_id = s.id
            WHERE sf.id = ?
        `).get(student_fee_id);

        res.render('fees/pay', {
            title: 'Record Payment',
            fee
        });
    } catch (err) {
        console.error('Pay Form Error:', err);
        res.status(500).send('Database Error');
    }
};

const processPayment = (req, res) => {
    const { student_fee_id, amount_paid, payment_method } = req.body;
    const receipt_number = 'REC-' + Date.now();

    try {
        const fee = db.prepare('SELECT * FROM student_fees WHERE id = ?').get(student_fee_id);
        const newPaidAmount = parseFloat(fee.paid_amount) + parseFloat(amount_paid);
        let status = 'Partial';
        if (newPaidAmount >= fee.total_amount) status = 'Paid';

        const runTransaction = db.transaction(() => {
            db.prepare(`
                INSERT INTO payments (student_id, student_fee_id, amount_paid, payment_method, receipt_number)
                VALUES (?, ?, ?, ?, ?)
            `).run(fee.student_id, student_fee_id, amount_paid, payment_method, receipt_number);

            db.prepare(`
                UPDATE student_fees SET paid_amount = ?, status = ? WHERE id = ?
            `).run(newPaidAmount, status, student_fee_id);
        });

        runTransaction();
        res.redirect(`/fees/receipt/${receipt_number}`);

    } catch (err) {
        console.error('Process Payment Error:', err);
        res.status(500).send('Error processing payment');
    }
};

const getReceipt = (req, res) => {
    const { receipt_number } = req.params;
    try {
        const payment = db.prepare(`
            SELECT p.*, s.first_name, s.last_name, s.admission_number, fc.name as fee_name, sf.total_amount, sf.paid_amount as total_paid_to_date
            FROM payments p
            JOIN students s ON p.student_id = s.id
            JOIN student_fees sf ON p.student_fee_id = sf.id
            JOIN fee_categories fc ON sf.fee_category_id = fc.id
            WHERE p.receipt_number = ?
            `).get(receipt_number);

        if (!payment) return res.status(404).send('Receipt not found');

        res.render('fees/receipt', {
            title: 'Payment Receipt',
            payment,
            school: res.locals.school // From settings middleware
        });
    } catch (err) {
        console.error('Receipt Error:', err);
        res.status(500).send('Database Error');
    }
};

module.exports = {
    getSetup,
    addFeeCategory,
    getFeeManager,
    getStudentFees,
    assignFee,
    getPayForm,
    processPayment,
    getReceipt
};
