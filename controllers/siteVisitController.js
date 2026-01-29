const SiteVisit = require('../models/siteVisitModel');
const sendMail = require('../utils/sendMail');
const { sendSiteVisitTemplate, sendFreeTextMessage} = require('../services/whatsappService');

exports.create = async (req, res, next) => {
  try {
    const { project = 'Kalpavruksha', name, phone, email, preferredDate, notes } = req.body || {};
    if (!name || !phone || !preferredDate) {
      return res.status(400).json({ success: false, message: 'name, phone, preferredDate are required' });
    }

    const visit = await SiteVisit.create({ project, name, phone, email, preferredDate, notes });

    // Prepare messages
    const dateStr = new Date(preferredDate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const userMsg = `Hi ${name},\n\nWe received your site visit request for ${project}.\nPreferred date/time: ${dateStr}.\nOur team will contact you shortly to confirm.\n\n— Easy Homes`;
    const adminMsg = `New Site Visit Request\nProject: ${project}\nName: ${name}\nPhone: ${phone}\nEmail: ${email || '-'}\nPreferred: ${dateStr}\nNotes: ${notes || '-'}`;

    // Send user email if available
    const emailPromises = [];
    if (email) {
      emailPromises.push(
        sendMail({
          to: email,
          subject: `We received your site visit request — ${project}`,
          text: userMsg,
          html: userMsg.replace(/\n/g, '<br/>')
        })
      );
    }
    // Send admin email if configured
    if (process.env.ADMIN_EMAIL) {
      emailPromises.push(
        sendMail({
          to: process.env.ADMIN_EMAIL,
          subject: `New Site Visit — ${project}`,
          text: adminMsg,
          html: adminMsg.replace(/\n/g, '<br/>')
        })
      );
    }

    try { await Promise.all(emailPromises); } catch (e) { console.warn('Email send error:', e.message); }

  await sendSiteVisitTemplate(phone, dateStr);
  // await sendFreeTextMessage(phone, userMsg);

    return res.status(201).json({ success: true, data: visit });
  } catch (err) {
    next(err);
  }
};
