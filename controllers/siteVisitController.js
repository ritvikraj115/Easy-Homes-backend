const SiteVisit = require('../models/siteVisitModel');
const sendMail = require('../utils/sendMail');
const { sendSiteVisitTemplate, sendFreeTextMessage } = require('../services/whatsappService');
const { createZohoCrmLead, isZohoCrmStrictMode } = require('../services/zohoCrmService');
const { createZohoAppointment, getZohoAvailableSlots } = require('../services/zohoBookingsService');

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

function normalizeOptionalValue(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return value;
}

function sanitizePickupDetails({
  transportRequired,
  pickupAddress,
  pickupMode,
  pickupLat,
  pickupLng
}) {
  const normalizedTransportRequired = normalizeTransportRequired(transportRequired);
  if (normalizedTransportRequired !== 'Yes') {
    return {
      pickupAddress: undefined,
      pickupMode: undefined,
      pickupLat: undefined,
      pickupLng: undefined
    };
  }

  const normalizedPickupAddress = String(pickupAddress || '').trim() || undefined;
  return {
    pickupAddress: normalizedPickupAddress,
    pickupMode: pickupMode || 'manual',
    pickupLat: normalizeOptionalValue(pickupLat),
    pickupLng: normalizeOptionalValue(pickupLng)
  };
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
    pickupLng,
    googleAdsAttribution,
    platformSource,
    platform_source,
  } = job;

  const normalizedTransportRequired = normalizeTransportRequired(transportRequired);
  const {
    pickupAddress: normalizedPickupAddress,
    pickupMode: normalizedPickupMode,
    pickupLat: normalizedPickupLat,
    pickupLng: normalizedPickupLng
  } = sanitizePickupDetails({
    transportRequired: normalizedTransportRequired,
    pickupAddress,
    pickupMode,
    pickupLat,
    pickupLng
  });
  const dateStr = new Date(preferredDate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const userMsg = `Hi ${name},\n\nWe received your site visit request for ${project}.\nPreferred date/time: ${dateStr}.\nOur team will contact you shortly to confirm.\n\n- Easy Homes`;
  const adminLines = [
    'New Site Visit Request',
    `Project: ${project}`,
    `Name: ${name}`,
    `Phone: ${phone}`,
    `Email: ${email || '-'}`,
    `Preferred: ${dateStr}`,
    `Transport Required: ${normalizedTransportRequired}`,
  ];
  if (normalizedTransportRequired === 'Yes') {
    adminLines.push(`Pickup Address: ${normalizedPickupAddress || '-'}`);
    adminLines.push(`Pickup Mode: ${normalizedPickupMode || '-'}`);
    adminLines.push(
      `Pickup Coordinates: ${normalizedPickupLat && normalizedPickupLng ? `${normalizedPickupLat}, ${normalizedPickupLng}` : '-'}`
    );
  }
  adminLines.push(`Notes: ${notes || '-'}`);
  const adminMsg = adminLines.join('\n');

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
  let zohoResponse = null;
  try {
    zohoResponse = await createZohoAppointment({
      project,
      name,
      phone,
      email,
      preferredDate,
      transportRequired: normalizedTransportRequired,
      pickupAddress: normalizedPickupAddress,
      pickupMode: normalizedPickupMode,
      pickupLat: normalizedPickupLat,
      pickupLng: normalizedPickupLng,
      notes
    });
    zohoDebug('zoho.done', { visitId, zohoResponse });
  } catch (zohoError) {
    zohoDebug('zoho.appointment.failed', { visitId, error: zohoError.message });

    const failReason = zohoError.details?.message || zohoError.message || 'Unknown error occurred while syncing with Zoho Bookings.';
    const isSlotError = /(slot not found|not available|mandatory|invalid|service not found)/i.test(failReason);

    let slotSuggestionText = '';

    // If the error was related to slot unavailability, query the official API for available times
    if (isSlotError) {
      const availableSlots = await getZohoAvailableSlots({ preferredDate });
      if (availableSlots && availableSlots.length > 0) {
        slotSuggestionText = `\n\nAvailable time slots for your selected date:\n${availableSlots.join(', ')}\n\nPlease reply to this email or contact us to secure one of these times.`;
      } else {
        slotSuggestionText = `\n\nUnfortunately, no alternative time slots are available on this date. Please contact us to choose a different day.`;
      }
    }

    const failSubject = `Site Visit Booking Issue - ${project}`;
    const OWNER_EMAIL = 'santhibushan.p@easyhomess.com';

    // 1. Send failure notice + slots to User
    if (email) {
      const failUserMsg = `Hi ${name},\n\nWe attempted to schedule your site visit for ${project} on ${dateStr}, but encountered an issue with our booking schedule.\n\nReason: ${failReason}${slotSuggestionText}\n\nOur team will also manually follow up with you shortly to assist.\n\n- Easy Homes`;

      sendMail({
        to: email,
        subject: failSubject,
        text: failUserMsg,
        html: failUserMsg.replace(/\n/g, '<br/>')
      }).catch(err => console.error('[site-visit] Failed to send user booking error email:', err.message));
    }

    // 2. Send failure notice to Owner
    const failOwnerMsg = `Alert: A Site Visit booking failed to sync with Zoho Bookings.\n\nProject: ${project}\nCustomer: ${name}\nPhone: ${phone}\nEmail: ${email || '-'}\nPreferred Date: ${dateStr}\n\nFailure Reason: ${failReason}\n\nPlease reach out to the customer manually to confirm their visit.`;

    sendMail({
      to: OWNER_EMAIL,
      subject: `[ACTION REQUIRED] ${failSubject}`,
      text: failOwnerMsg,
      html: failOwnerMsg.replace(/\n/g, '<br/>')
    }).catch(err => console.error('[site-visit] Failed to send owner booking error email:', err.message));
    return;
  }

  try {
    const crmNotes = [
      'Lead event: Site visit scheduled via website form',
      notes ? `Site visit notes: ${notes}` : null,
      normalizedPickupMode ? `Pickup mode: ${normalizedPickupMode}` : null,
      normalizedPickupLat && normalizedPickupLng ? `Pickup coordinates: ${normalizedPickupLat}, ${normalizedPickupLng}` : null,
      normalizedPickupAddress ? `Pickup address: ${normalizedPickupAddress}` : null,
      `Transport required: ${normalizedTransportRequired}`,
    ].filter(Boolean).join('\n');

    const crmResponse = await createZohoCrmLead({
      project,
      source: 'Website',
      platformSource: platformSource || platform_source || 'Website',
      leadStatus: 'Visit Scheduled',
      name,
      phone,
      email,
      preferredDate,
      pickupAddress: normalizedPickupAddress,
      googleAdsAttribution,
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
      pickupLng,
      googleAdsAttribution,
      platformSource,
      platform_source,
    } = req.body || {};
    const normalizedTransportRequired = normalizeTransportRequired(transportRequired);
    const {
      pickupAddress: normalizedPickupAddress,
      pickupMode: normalizedPickupMode,
      pickupLat: normalizedPickupLat,
      pickupLng: normalizedPickupLng
    } = sanitizePickupDetails({
      transportRequired: normalizedTransportRequired,
      pickupAddress,
      pickupMode,
      pickupLat,
      pickupLng
    });

    zohoDebug('create.received', {
      project,
      name: name || null,
      phone: maskPhone(phone),
      hasEmail: Boolean(email),
      preferredDate: preferredDate || null,
      transportRequired: normalizedTransportRequired,
      hasNotes: Boolean(notes),
      hasPickupAddress: Boolean(normalizedPickupAddress),
      pickupMode: normalizedPickupMode || null,
      hasGoogleAdsAttribution: Boolean(googleAdsAttribution)
    });

    const normalizedProject = String(project || '').trim().toLowerCase();
    const scopedProjects = getZohoProjectScope();
    const syncsToZohoBookings = scopedProjects ? scopedProjects.includes(normalizedProject) : normalizedProject === 'kalpavruksha';

    // 1. Basic Required Fields Check
    if (!name || !phone || !preferredDate) {
      return res.status(400).json({ success: false, message: 'name, phone, preferredDate are required' });
    }

    // =========================================================================
    // 2. STRICT 10-DIGIT PHONE VALIDATION
    // =========================================================================
    const phoneStr = String(phone).trim();
    const phoneRegex = /^\d{10}$/; // Matches exactly 10 digits (0-9)
    if (!phoneRegex.test(phoneStr)) {
      return res.status(400).json({
        success: false,
        message: 'Phone number must be strictly 10 digits.'
      });
    }
    // =========================================================================

    if (syncsToZohoBookings && !String(email || '').trim()) {
      return res.status(400).json({ success: false, message: 'email is required for site visit booking' });
    }

    const requiresPickupAddress = scopedProjects ? scopedProjects.includes(normalizedProject) : normalizedProject === 'kalpavruksha';
    if (normalizedTransportRequired === 'Yes' && requiresPickupAddress && !normalizedPickupAddress) {
      return res.status(400).json({ success: false, message: 'pickupAddress is required' });
    }

    const visit = await SiteVisit.create({
      project,
      name,
      phone: phoneStr, // Saving the trimmed 10-digit string
      email,
      preferredDate,
      transportRequired: normalizedTransportRequired,
      pickupAddress: normalizedPickupAddress,
      pickupMode: normalizedPickupMode,
      pickupLat: normalizedPickupLat,
      pickupLng: normalizedPickupLng,
      notes,
      platformSource: 'Website',
      platform_source: 'Website'
    });
    const visitId = String(visit?._id || '');
    zohoDebug('create.saved', { visitId, asyncProcessing: true });

    scheduleSiteVisitPostProcessing({
      visitId,
      project,
      name,
      phone: phoneStr,
      email,
      preferredDate,
      transportRequired: normalizedTransportRequired,
      notes,
      googleAdsAttribution,
      pickupAddress: normalizedPickupAddress,
      pickupMode: normalizedPickupMode,
      pickupLat: normalizedPickupLat,
      pickupLng: normalizedPickupLng,
      platformSource: platformSource || platform_source || 'Website'
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