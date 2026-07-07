const { createZohoCrmLead, isZohoCrmStrictMode } = require('../services/zohoCrmService');
const { createZohoAppointment, getZohoAvailableSlots } = require('../services/zohoBookingsService');

function inferDownloadLeadStatus(rawValue) {
  const text = String(rawValue || '').trim().toLowerCase();
  if (!text) return '';
  if (text.includes('brochure')) return 'Brochure and Map Requested on WhatsApp';
  if (text.includes('layout')) return 'Downloaded Layout';
  return '';
}

function normalizeText(value) {
  const text = String(value || '').trim();
  return text || undefined;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(value || '').trim());
}

function normalizeIndianNationalPhone(value) {
  const digitsOnly = String(value || '').replace(/\D/g, '');
  const nationalNumber = digitsOnly.length > 10 ? digitsOnly.slice(-10) : digitsOnly;
  return /^[6-9]\d{9}$/.test(nationalNumber) ? nationalNumber : '';
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

function appendLandingVariantNotes(noteLines, { landingVariant, landingVersion } = {}) {
  if (landingVersion || landingVariant) {
    noteLines.push(`Landing Version: ${landingVersion || '-'} (${landingVariant || '-'})`);
  }
  return noteLines;
}

function buildWebsiteEnquiryNotes({ placement, landingVariant, landingVersion }) {
  const noteLines = ['Lead event: Website enquiry / callback request'];
  if (placement) {
    noteLines.push(`Form placement: ${placement}`);
  }
  return appendLandingVariantNotes(noteLines, { landingVariant, landingVersion }).join('\n');
}

function buildDownloadLeadNotes({ notes, landingVariant, landingVersion }) {
  const noteLines = [];
  if (notes) noteLines.push(String(notes).trim());
  appendLandingVariantNotes(noteLines, { landingVariant, landingVersion });
  return noteLines.join('\n') || undefined;
}

function resolveWebsiteEnquiryLeadStatus(rawValue) {
  return normalizeText(rawValue) || 'Callback Requested';
}

exports.captureWebsiteEnquiryLead = async (req, res, next) => {
  try {
    const {
      project = 'General Inquiry',
      name,
      phone,
      email,
      requirements,
      placement,
      platformSource,
      platform_source,
      leadStatus,
      landingVariant,
      landing_variant,
      landingVersion,
      landing_version,
      version,
      googleAdsAttribution,
    } = req.body || {};
    const source = 'Website';
    const normalizedLandingVariant = normalizeLandingVariant(landingVariant || landing_variant);
    const normalizedLandingVersion = normalizeLandingVersion(landingVersion || landing_version || version, normalizedLandingVariant);

    const normalizedEmail = normalizeText(email);

    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        message: 'name and phone are required',
      });
    }

    if (normalizedEmail && !isValidEmail(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'A valid email address is required',
      });
    }

    try {
      await createZohoCrmLead({
        project,
        source,
        platformSource: normalizeText(platformSource) || normalizeText(platform_source) || 'Website',
        leadStatus: resolveWebsiteEnquiryLeadStatus(leadStatus),
        name,
        phone,
        email: normalizedEmail,
        requirements: normalizeText(requirements),
        landingVariant: normalizedLandingVariant,
        landingVersion: normalizedLandingVersion,
        version: normalizedLandingVersion,
        googleAdsAttribution,
        notes: buildWebsiteEnquiryNotes({
          placement: normalizeText(placement),
          landingVariant: normalizedLandingVariant,
          landingVersion: normalizedLandingVersion,
        }),
      });
    } catch (crmError) {
      console.error('[lead] crm.sync.failed', crmError.message);
      if (isZohoCrmStrictMode()) {
        throw crmError;
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Lead captured successfully',
    });
  } catch (err) {
    return next(err);
  }
};

exports.captureLayoutDownloadLead = async (req, res, next) => {
  try {
    const {
      project = 'Kalpavruksha',
      source: rawSource,
      platformSource,
      platform_source,
      leadStatus,
      landingVariant,
      landing_variant,
      landingVersion,
      landing_version,
      version,
      name,
      phone,
      email,
      notes,
      googleAdsAttribution,
    } = req.body || {};
    const source = 'Website';
    const normalizedLandingVariant = normalizeLandingVariant(landingVariant || landing_variant);
    const normalizedLandingVersion = normalizeLandingVersion(landingVersion || landing_version || version, normalizedLandingVariant);

    const resolvedLeadStatus =
      String(leadStatus || '').trim() ||
      inferDownloadLeadStatus(rawSource);
    const normalizedEmail = normalizeText(email);

    if (!name || !phone || !normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: 'name, phone and email are required',
      });
    }

    // =========================================================================
    // STRICT 10-DIGIT PHONE VALIDATION
    // =========================================================================
    const phoneStr = normalizeIndianNationalPhone(phone);
    if (!phoneStr) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number must be a valid 10-digit Indian mobile number.' 
      });
    }
    // =========================================================================

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'A valid email address is required',
      });
    }

    try {
      await createZohoCrmLead({
        project,
        source,
        platformSource: normalizeText(platformSource) || normalizeText(platform_source) || 'Website',
        leadStatus: resolvedLeadStatus || undefined,
        name,
        phone: phoneStr, // <--- Send the clean, validated string to Zoho
        email: normalizedEmail,
        landingVariant: normalizedLandingVariant,
        landingVersion: normalizedLandingVersion,
        version: normalizedLandingVersion,
        googleAdsAttribution,
        notes: buildDownloadLeadNotes({
          notes: normalizeText(notes),
          landingVariant: normalizedLandingVariant,
          landingVersion: normalizedLandingVersion,
        }),
      });
    } catch (crmError) {
      console.error('[lead] crm.sync.failed', crmError.message);
      if (isZohoCrmStrictMode()) {
        throw crmError;
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Lead captured successfully',
    });
  } catch (err) {
    return next(err);
  }
};
