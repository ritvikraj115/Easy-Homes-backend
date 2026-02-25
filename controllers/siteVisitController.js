const SiteVisit = require('../models/siteVisitModel');
const sendMail = require('../utils/sendMail');
const { sendSiteVisitTemplate, sendFreeTextMessage } = require('../services/whatsappService');
const { createZohoAppointment } = require('../services/zohoBookingsService');
const { createZohoCrmLead, isZohoCrmStrictMode } = require('../services/zohoCrmService');

function isZohoDebugEnabled() {
  const value = String(process.env.ZOHO_BOOKINGS_DEBUG || '').toLowerCase();
  return value === 'true' || value === '1' || value === 'yes' || value === 'on';
}

function maskPhone(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length <= 4) return '***';
  return `***${digits.slice(-4)}`;
}

function zohoDebug(step, meta) {
  if (!isZohoDebugEnabled()) return;
  const stamp = new Date().toISOString();
  if (meta === undefined) {
    console.error(`[site-visit] ${stamp} ${step}`);
    return;
  }
  try {
    console.error(`[site-visit] ${stamp} ${step} ${JSON.stringify(meta)}`);
  } catch (error) {
    console.error(`[site-visit] ${stamp} ${step} ${String(meta)}`);
  }
}

function getZohoProjectScope() {
  const raw = process.env.ZOHO_BOOKINGS_PROJECTS;
  if (!raw) return null;
  const list = raw
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : null;
}

function normalizeTransportRequired(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'no' || text === 'false' || text === '0') return 'No';
  return 'Yes';
}

function scheduleSiteVisitPostProcessing(job) {
  setImmediate(() => {
    processSiteVisitPostProcessing(job).catch((err) => {
      console.error('[site-visit] post_process.failed', err.message);
      zohoDebug('post_process.error', {
        visitId: job?.visitId || null,
        message: err.message,
        status: err.response?.status || null,
        data: err.response?.data || null,
        details: err.details || null
      });
    });
  });
}

async function processSiteVisitPostProcessing(job) {
  const {
    visitId,
    project,
    name,
    phone,
    email,
    preferredDate,
    transportRequired,
    notes,
    pickupAddress,
    pickupMode,
    pickupLat,
    pickupLng
  } = job;

  const normalizedTransportRequired = normalizeTransportRequired(transportRequired);
  const dateStr = new Date(preferredDate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const userMsg = `Hi ${name},\n\nWe received your site visit request for ${project}.\nPreferred date/time: ${dateStr}.\nOur team will contact you shortly to confirm.\n\n- Easy Homes`;
  const adminMsg = `New Site Visit Request\nProject: ${project}\nName: ${name}\nPhone: ${phone}\nEmail: ${email || '-'}\nPreferred: ${dateStr}\nTransport Required: ${normalizedTransportRequired}\nPickup Address: ${pickupAddress || '-'}\nPickup Mode: ${pickupMode || 'manual'}\nPickup Coordinates: ${pickupLat && pickupLng ? `${pickupLat}, ${pickupLng}` : '-'}\nNotes: ${notes || '-'}`;

  const emailPromises = [];
  if (email) {
    emailPromises.push(
      sendMail({
        to: email,
        subject: `We received your site visit request - ${project}`,
        text: userMsg,
        html: userMsg.replace(/\n/g, '<br/>')
      })
    );
  }

  if (process.env.ADMIN_EMAIL) {
    emailPromises.push(
      sendMail({
        to: process.env.ADMIN_EMAIL,
        subject: `New Site Visit - ${project}`,
        text: adminMsg,
        html: adminMsg.replace(/\n/g, '<br/>')
      })
    );
  }

  try {
    await Promise.all(emailPromises);
  } catch (e) {
    console.warn('Email send error:', e.message);
  }

  zohoDebug('zoho.start', { visitId });
  const zohoResponse = await createZohoAppointment({
    project,
    name,
    phone,
    email,
    preferredDate,
    transportRequired: normalizedTransportRequired,
    pickupAddress,
    pickupMode,
    pickupLat,
    pickupLng,
    notes
  });
  zohoDebug('zoho.done', { visitId, zohoResponse });

  try {
    const crmNotes = [
      'Lead event: Site visit scheduled via website form',
      notes ? `Site visit notes: ${notes}` : null,
      pickupMode ? `Pickup mode: ${pickupMode}` : null,
      pickupLat && pickupLng ? `Pickup coordinates: ${pickupLat}, ${pickupLng}` : null,
      pickupAddress ? `Pickup address: ${pickupAddress}` : null,
      `Transport required: ${normalizedTransportRequired}`,
    ].filter(Boolean).join('\n');

    const crmResponse = await createZohoCrmLead({
      project,
      source: 'Website',
      leadStatus: 'Visit Scheduled',
      name,
      phone,
      email,
      preferredDate,
      pickupAddress,
      notes: crmNotes,
    });
    zohoDebug('crm.done', { visitId, synced: Boolean(crmResponse) });
  } catch (crmError) {
    console.error('[site-visit] crm.sync.failed', crmError.message);
    zohoDebug('crm.error', {
      visitId,
      message: crmError.message,
      code: crmError.code || null,
      details: crmError.details || crmError.response?.data || null,
    });
    if (isZohoCrmStrictMode()) {
      throw crmError;
    }
  }

  await sendSiteVisitTemplate(phone, dateStr);
  // await sendFreeTextMessage(phone, userMsg);
}

exports.create = async (req, res, next) => {
  try {
    const {
      project = 'Kalpavruksha',
      name,
      phone,
      email,
      preferredDate,
      transportRequired,
      notes,
      pickupAddress,
      pickupMode,
      pickupLat,
      pickupLng
    } = req.body || {};

    zohoDebug('create.received', {
      project,
      name: name || null,
      phone: maskPhone(phone),
      hasEmail: Boolean(email),
      preferredDate: preferredDate || null,
      transportRequired: normalizeTransportRequired(transportRequired),
      hasNotes: Boolean(notes),
      hasPickupAddress: Boolean(pickupAddress),
      pickupMode: pickupMode || null
    });

    if (!name || !phone || !preferredDate) {
      return res.status(400).json({ success: false, message: 'name, phone, preferredDate are required' });
    }

    const normalizedProject = String(project || '').trim().toLowerCase();
    const scopedProjects = getZohoProjectScope();
    const requiresPickupAddress = scopedProjects ? scopedProjects.includes(normalizedProject) : normalizedProject === 'kalpavruksha';
    if (requiresPickupAddress && !pickupAddress) {
      return res.status(400).json({ success: false, message: 'pickupAddress is required' });
    }

    const visit = await SiteVisit.create({
      project,
      name,
      phone,
      email,
      preferredDate,
      transportRequired: normalizeTransportRequired(transportRequired),
      pickupAddress: pickupAddress || undefined,
      pickupMode: pickupMode || 'manual',
      pickupLat: pickupLat ?? undefined,
      pickupLng: pickupLng ?? undefined,
      notes
    });
    const visitId = String(visit?._id || '');
    zohoDebug('create.saved', { visitId, asyncProcessing: true });

    scheduleSiteVisitPostProcessing({
      visitId,
      project,
      name,
      phone,
      email,
      preferredDate,
      transportRequired: normalizeTransportRequired(transportRequired),
      notes,
      pickupAddress,
      pickupMode,
      pickupLat,
      pickupLng
    });

    return res.status(201).json({
      success: true,
      data: visit,
      processing: 'queued'
    });
  } catch (err) {
    console.error('[site-visit] create.failed', err.message);
    zohoDebug('create.error', {
      message: err.message,
      status: err.response?.status || null,
      data: err.response?.data || null,
      details: err.details || null
    });
    next(err);
  }
};
