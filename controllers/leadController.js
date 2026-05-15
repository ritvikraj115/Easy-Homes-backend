const { createZohoCrmLead, isZohoCrmStrictMode } = require('../services/zohoCrmService');

function inferDownloadLeadStatus(rawValue) {
  const text = String(rawValue || '').trim().toLowerCase();
  if (!text) return '';
  if (text.includes('brochure')) return 'Downloaded Brochure';
  if (text.includes('layout')) return 'Downloaded Layout';
  return '';
}

function normalizeText(value) {
  const text = String(value || '').trim();
  return text || undefined;
}

function buildWebsiteEnquiryNotes({ placement }) {
  const noteLines = ['Lead event: Website enquiry / callback request'];
  if (placement) {
    noteLines.push(`Form placement: ${placement}`);
  }
  return noteLines.join('\n');
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
      leadStatus,
    } = req.body || {};
    const source = 'Website';

    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        message: 'name and phone are required',
      });
    }

    try {
      await createZohoCrmLead({
        project,
        source,
        leadStatus: resolveWebsiteEnquiryLeadStatus(leadStatus),
        name,
        phone,
        email: normalizeText(email),
        requirements: normalizeText(requirements),
        notes: buildWebsiteEnquiryNotes({
          placement: normalizeText(placement),
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
      leadStatus,
      name,
      phone,
      email,
      notes,
    } = req.body || {};
    const source = 'Website';

    const resolvedLeadStatus =
      String(leadStatus || '').trim() ||
      inferDownloadLeadStatus(rawSource);

    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        message: 'name and phone are required',
      });
    }

    try {
      await createZohoCrmLead({
        project,
        source,
        leadStatus: resolvedLeadStatus || undefined,
        name,
        phone,
        email,
        notes,
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
