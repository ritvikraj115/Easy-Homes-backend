const SiteVisit = require('../models/siteVisitModel');
const sendMail = require('../utils/sendMail');
const { sendSiteVisitTemplate, sendFreeTextMessage } = require('../services/whatsappService');
const { createZohoCrmLead, isZohoCrmStrictMode } = require('../services/zohoCrmService');
const { createZohoAppointment, getZohoAvailableSlots, getZohoAvailableSlotsDetailed } = require('../services/zohoBookingsService');

const BOOKING_FAILURE_RECIPIENTS = [
  'santhibushan.p@easyhomess.com',
  'operations@easyhomess.com',
];

const BOOKING_FAILURE_SIGNATURE = [
  'Regards,',
  'Ritvik Raj',
  'Developer',
  'Easy Homes',
].join('\n');

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

function normalizeLandingVariant(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'a' || normalized === 'lp_a' || normalized === 'v1') return 'A';
  if (normalized === 'b' || normalized === 'lp_b' || normalized === 'v2') return 'B';
  return undefined;
}

function normalizeLandingVersion(value, variant) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'v1' || normalized === 'version_1') return 'v1';
  if (normalized === 'v2' || normalized === 'version_2') return 'v2';
  if (variant === 'A') return 'v1';
  if (variant === 'B') return 'v2';
  return undefined;
}

function normalizeOptionalValue(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return value;
}

function normalizeBooleanFlag(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

const PICKUP_ADDRESS_MAX_LENGTH = 50;

function normalizePickupAddress(value) {
  const normalized = String(value || '').trim();
  return normalized ? normalized.slice(0, PICKUP_ADDRESS_MAX_LENGTH) : undefined;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(value || '').trim());
}

function normalizeIndianNationalPhone(value) {
  const digitsOnly = String(value || '').replace(/\D/g, '');
  const nationalNumber = digitsOnly.length > 10 ? digitsOnly.slice(-10) : digitsOnly;
  return /^[6-9]\d{9}$/.test(nationalNumber) ? nationalNumber : '';
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

  const normalizedPickupAddress = normalizePickupAddress(pickupAddress);
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
    landingVariant,
    landing_variant,
    landingVersion,
    landing_version,
    version,
    slotAvailabilityIssue,
    slotAvailabilityIssueReason,
    slotAvailabilitySource,
  } = job;
  const normalizedLandingVariant = normalizeLandingVariant(landingVariant || landing_variant);
  const normalizedLandingVersion = normalizeLandingVersion(landingVersion || landing_version || version, normalizedLandingVariant);

  const normalizedTransportRequired = normalizeTransportRequired(transportRequired);
  const rawPickupAddress = String(pickupAddress || '').trim() || undefined;
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
  if (normalizedLandingVariant || normalizedLandingVersion) {
    adminLines.push(`Landing Version: ${normalizedLandingVersion || '-'} (${normalizedLandingVariant || '-'})`);
  }
  if (slotAvailabilityIssue || slotAvailabilityIssueReason || slotAvailabilitySource) {
    adminLines.push(`Slot Availability Source: ${slotAvailabilitySource || '-'}`);
    adminLines.push(`Slot Availability Issue: ${slotAvailabilityIssue ? 'Yes' : 'No'}`);
    adminLines.push(`Slot Availability Issue Reason: ${slotAvailabilityIssueReason || '-'}`);
  }
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
    if (!zohoResponse && slotAvailabilityIssue) {
      const availabilityError = new Error(
        slotAvailabilityIssueReason || 'Live slot availability could not be verified; manual confirmation is required.'
      );
      availabilityError.code = 'ZOHO_SLOT_AVAILABILITY_UNVERIFIED';
      availabilityError.details = {
        message: availabilityError.message,
        slotAvailabilitySource: slotAvailabilitySource || 'fallback',
      };
      throw availabilityError;
    }
    zohoDebug('zoho.done', { visitId, zohoResponse });
  } catch (zohoError) {
    zohoDebug('zoho.appointment.failed', { visitId, error: zohoError.message });

    const failReason = zohoError.details?.message || zohoError.message || 'Unknown error occurred while syncing with Zoho Bookings.';
    const isSlotError = /(slot not found|not available|mandatory|invalid|service not found)/i.test(failReason);

    let slotSuggestionText = '';
    let slotLookupFailureReason = '';

    // If the error was related to slot unavailability, query the official API for available times
    if (isSlotError) {
      try {
        const availableSlots = await getZohoAvailableSlots({ preferredDate });
        if (availableSlots && availableSlots.length > 0) {
          slotSuggestionText = `\n\nAvailable time slots for your selected date:\n${availableSlots.join(', ')}\n\nPlease reply to this email or contact us to secure one of these times.`;
        } else {
          slotSuggestionText = `\n\nUnfortunately, no alternative time slots are available on this date. Please contact us to choose a different day.`;
        }
      } catch (slotError) {
        slotLookupFailureReason = slotError.message || 'Alternative slot lookup failed.';
        console.error('[site-visit] available_slots.lookup.failed', slotLookupFailureReason);
        slotSuggestionText = `\n\nWe could not automatically fetch alternative time slots. Our team will manually review availability and contact you shortly.`;
      }
    }

    const failSubject = `Site Visit Booking Issue - ${project}`;

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

    // 2. Send failure notice to the internal operations team
    const failOwnerLines = [
      'Dear Team,',
      '',
      'A site visit request was received from the website, but the appointment could not be created in Zoho Bookings.',
      'Please review the details below and manually confirm the visit with the customer.',
      '',
      `Project: ${project}`,
      `Customer Name: ${name}`,
      `Phone Number: ${phone}`,
      `Email: ${email || '-'}`,
      `Preferred Date/Time: ${dateStr}`,
      `Transport Required: ${normalizedTransportRequired}`,
    ];
    if (normalizedTransportRequired === 'Yes') {
      failOwnerLines.push(`Pickup Address: ${rawPickupAddress || normalizedPickupAddress || '-'}`);
      failOwnerLines.push(`Pickup Mode: ${normalizedPickupMode || '-'}`);
      failOwnerLines.push(
        `Pickup Coordinates: ${normalizedPickupLat && normalizedPickupLng ? `${normalizedPickupLat}, ${normalizedPickupLng}` : '-'}`
      );
    }
    if (normalizedLandingVariant || normalizedLandingVersion) {
      failOwnerLines.push(`Landing Version: ${normalizedLandingVersion || '-'} (${normalizedLandingVariant || '-'})`);
    }
    if (slotAvailabilitySource || slotAvailabilityIssue || slotAvailabilityIssueReason) {
      failOwnerLines.push(`Slot Availability Source: ${slotAvailabilitySource || '-'}`);
      failOwnerLines.push(`Slot Availability Issue: ${slotAvailabilityIssue ? 'Yes' : 'No'}`);
      failOwnerLines.push(`Slot Availability Issue Reason: ${slotAvailabilityIssueReason || '-'}`);
    }
    if (slotLookupFailureReason) {
      failOwnerLines.push(`Alternative Slot Lookup Failure: ${slotLookupFailureReason}`);
    }
    failOwnerLines.push(
      '',
      `Failure Reason: ${failReason}`,
      '',
      'Action Required:',
      'Please contact the customer, confirm the correct slot manually, and update the booking/CRM status accordingly.',
      '',
      BOOKING_FAILURE_SIGNATURE
    );
    const failOwnerMsg = failOwnerLines.join('\n');

    sendMail({
      to: BOOKING_FAILURE_RECIPIENTS,
      subject: `[ACTION REQUIRED] ${failSubject}`,
      text: failOwnerMsg,
      html: failOwnerMsg.replace(/\n/g, '<br/>')
    }).catch(err => console.error('[site-visit] Failed to send internal booking error email:', err.message));

    try {
      const crmNotes = [
        'Lead event: Site visit requested via website form, but Zoho Bookings could not create the appointment.',
        `Lead status reason: Slot availabilty issue`,
        `Preferred date/time selected by user: ${dateStr}`,
        `Zoho Bookings failure reason: ${failReason}`,
        slotAvailabilitySource ? `Slot availability source shown to user: ${slotAvailabilitySource}` : null,
        slotAvailabilityIssue ? 'Fallback slot list was shown because live availability could not be verified.' : null,
        slotAvailabilityIssueReason ? `Live availability issue reason: ${slotAvailabilityIssueReason}` : null,
        notes ? `Site visit notes: ${notes}` : null,
        normalizedPickupMode ? `Pickup mode: ${normalizedPickupMode}` : null,
        normalizedPickupLat && normalizedPickupLng ? `Pickup coordinates: ${normalizedPickupLat}, ${normalizedPickupLng}` : null,
        rawPickupAddress ? `Pickup address: ${rawPickupAddress}` : null,
        `Transport required: ${normalizedTransportRequired}`,
      ].filter(Boolean).join('\n');

      const crmResponse = await createZohoCrmLead({
        project,
        source: 'Website',
        platformSource: platformSource || platform_source || 'Website',
        leadStatus: 'Slot availabilty issue',
        name,
        phone,
        email,
        preferredDate,
        pickupAddress: rawPickupAddress,
        landingVariant: normalizedLandingVariant,
        landingVersion: normalizedLandingVersion,
        version: normalizedLandingVersion,
        googleAdsAttribution,
        requirements: 'Site visit requested, but Zoho Bookings appointment could not be created.',
        notes: crmNotes,
      });
      zohoDebug('crm.slot_issue.done', { visitId, synced: Boolean(crmResponse) });
    } catch (crmError) {
      console.error('[site-visit] crm.slot_issue.sync.failed', crmError.message);
      zohoDebug('crm.slot_issue.error', {
        visitId,
        message: crmError.message,
        code: crmError.code || null,
        details: crmError.details || crmError.response?.data || null,
      });
      if (isZohoCrmStrictMode()) {
        throw crmError;
      }
    }
    return;
  }

  try {
    const crmNotes = [
      'Lead event: Site visit scheduled via website form',
      notes ? `Site visit notes: ${notes}` : null,
      normalizedPickupMode ? `Pickup mode: ${normalizedPickupMode}` : null,
      normalizedPickupLat && normalizedPickupLng ? `Pickup coordinates: ${normalizedPickupLat}, ${normalizedPickupLng}` : null,
      rawPickupAddress ? `Pickup address: ${rawPickupAddress}` : null,
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
      pickupAddress: rawPickupAddress,
      landingVariant: normalizedLandingVariant,
      landingVersion: normalizedLandingVersion,
      version: normalizedLandingVersion,
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
      landingVariant,
      landing_variant,
      landingVersion,
      landing_version,
      version,
      slotAvailabilityIssue,
      slotAvailabilityIssueReason,
      slotAvailabilitySource,
    } = req.body || {};
    const rawPickupAddress = String(pickupAddress || '').trim() || undefined;
    const normalizedLandingVariant = normalizeLandingVariant(landingVariant || landing_variant);
    const normalizedLandingVersion = normalizeLandingVersion(landingVersion || landing_version || version, normalizedLandingVariant);
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
      landingVariant: normalizedLandingVariant || null,
      landingVersion: normalizedLandingVersion || null,
      slotAvailabilityIssue: normalizeBooleanFlag(slotAvailabilityIssue),
      slotAvailabilitySource: slotAvailabilitySource || null,
      hasGoogleAdsAttribution: Boolean(googleAdsAttribution)
    });

    const normalizedProject = String(project || '').trim().toLowerCase();
    const scopedProjects = getZohoProjectScope();
    const syncsToZohoBookings = scopedProjects ? scopedProjects.includes(normalizedProject) : normalizedProject === 'kalpavruksha';

    // 1. Basic Required Fields Check
    if (!name || !phone || !preferredDate) {
      return res.status(400).json({ success: false, message: 'name, phone, preferredDate are required' });
    }

    const phoneStr = normalizeIndianNationalPhone(phone);
    if (!phoneStr) {
      return res.status(400).json({
        success: false,
        message: 'Phone number must be a valid 10-digit Indian mobile number.'
      });
    }

    const normalizedEmail = String(email || '').trim();
    const requiresEmail = normalizedProject === 'kalpavruksha' || Boolean(normalizedLandingVersion || normalizedLandingVariant);
    if (requiresEmail && !normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: 'email is required'
      });
    }
    if (normalizedEmail && !isValidEmail(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'A valid email address is required'
      });
    }

    const bookingEmail = syncsToZohoBookings && !normalizedEmail
      ? `${phoneStr}@easyhomess.com`
      : normalizedEmail;

    const requiresPickupAddress = scopedProjects ? scopedProjects.includes(normalizedProject) : normalizedProject === 'kalpavruksha';
    if (normalizedTransportRequired === 'Yes' && requiresPickupAddress && !normalizedPickupAddress) {
      return res.status(400).json({ success: false, message: 'pickupAddress is required' });
    }

    const visit = await SiteVisit.create({
      project,
      name,
      phone: phoneStr, // Saving the trimmed 10-digit string
      email: bookingEmail || undefined,
      preferredDate,
      transportRequired: normalizedTransportRequired,
      pickupAddress: normalizedPickupAddress,
      pickupMode: normalizedPickupMode,
      pickupLat: normalizedPickupLat,
      pickupLng: normalizedPickupLng,
      notes,
      platformSource: platformSource || platform_source || 'Website',
      platform_source: platformSource || platform_source || 'Website',
      landingVariant: normalizedLandingVariant,
      landing_variant: normalizedLandingVariant,
      landingVersion: normalizedLandingVersion,
      landing_version: normalizedLandingVersion,
      version: normalizedLandingVersion,
      slotAvailabilityIssue: normalizeBooleanFlag(slotAvailabilityIssue),
      slotAvailabilityIssueReason: slotAvailabilityIssueReason || undefined,
      slotAvailabilitySource: slotAvailabilitySource || undefined
    });
    const visitId = String(visit?._id || '');
    zohoDebug('create.saved', { visitId, asyncProcessing: true });

    scheduleSiteVisitPostProcessing({
      visitId,
      project,
      name,
      phone: phoneStr,
      email: bookingEmail || undefined,
      preferredDate,
      transportRequired: normalizedTransportRequired,
      notes,
      googleAdsAttribution,
      pickupAddress: rawPickupAddress,
      pickupMode: normalizedPickupMode,
      pickupLat: normalizedPickupLat,
      pickupLng: normalizedPickupLng,
      platformSource: platformSource || platform_source || 'Website',
      landingVariant: normalizedLandingVariant,
      landing_variant: normalizedLandingVariant,
      landingVersion: normalizedLandingVersion,
      landing_version: normalizedLandingVersion,
      version: normalizedLandingVersion,
      slotAvailabilityIssue: normalizeBooleanFlag(slotAvailabilityIssue),
      slotAvailabilityIssueReason: slotAvailabilityIssueReason || undefined,
      slotAvailabilitySource: slotAvailabilitySource || undefined
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

exports.getAvailableSlots = async (req, res, next) => {
  try {
    const preferredDate = req.query.preferredDate || req.query.date;
    if (!preferredDate) {
      return res.status(400).json({
        success: false,
        message: 'preferredDate is required',
      });
    }

    const availability = await getZohoAvailableSlotsDetailed({ preferredDate });
    return res.json({
      success: true,
      slots: availability.slots,
      availabilityStatus: availability.availabilityStatus,
      availabilityMessage: availability.availabilityMessage,
    });
  } catch (err) {
    return next(err);
  }
};
