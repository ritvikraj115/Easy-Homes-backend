const nodemailer = require('nodemailer');

// Configure via environment variables:
const transporter = nodemailer.createTransport({
  host:     process.env.SMTP_HOST,
  port:     parseInt(process.env.SMTP_PORT, 10),
  secure:   process.env.SMTP_SECURE === 'true', // true for 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

/**
 * sendMail({ to, subject, text, html })
 */
module.exports = async function sendMail({ to, subject, text, html }) {
  const info = await transporter.sendMail({
    from:    `"Easy Homes" <${process.env.SMTP_FROM}>`,
    to,
    subject,
    text,
    html
  });
  console.log('Email sent:', info.messageId);
};
