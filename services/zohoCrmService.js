const axios = require('axios');

const DEBUG_PREFIX = '[zoho-crm]';

let cachedAccessToken = null;
let cachedApiDomain = null;
let tokenExpiresAt = 0;

function env(primaryKey, fallbackKey) {
  return process.env[primaryKey] || (fallbackKey ? process.env[fallbackKey] : undefined);
}

function isEnabled() {
  return String(process.env.ZOHO_CRM_ENABLED || '').toLowerCase() === 'true';
}

function isStrictMode() {
  const value = String(process.env.ZOHO_CRM_STRICT || '').toLowerCase();
  return value === 'true' || value === '1' || value === 'yes' || value === 'on';
}

function isDebugEnabled() {
  const value = String(process.env.ZOHO_CRM_DEBUG || '').toLowerCase();
  return value === 'true' || value === '1' || value === 'yes' || value === 'on';
}

function logDebug(step, meta) {
  if (!isDebugEnabled()) return;
  const stamp = new Date().toISOString();
  if (meta === undefined) {
    console.error(`${DEBUG_PREFIX} ${stamp} ${step}`);
    return;
  }
  try {
    console.error(`${DEBUG_PREFIX} ${stamp} ${step} ${JSON.stringify(meta)}`);
  } catch {
    console.error(`${DEBUG_PREFIX} ${stamp} ${step}`);
  }
}

function maskSecret(value) {
  if (!value) return null;
  const text = String(value);
  if (text.length <= 10) return '***';
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function hasRefreshFlow() {
  return Boolean(
    env('ZOHO_CRM_ACCOUNTS_URL', 'ZOHO_ACCOUNTS_URL') &&
    env('ZOHO_CRM_CLIENT_ID', 'ZOHO_BOOKINGS_CLIENT_ID') &&
    env('ZOHO_CRM_CLIENT_SECRET', 'ZOHO_BOOKINGS_CLIENT_SECRET') &&
    env('ZOHO_CRM_REFRESH_TOKEN', 'ZOHO_BOOKINGS_REFRESH_TOKEN')
  );
}

function hasExplicitCrmRefreshFlow() {
  return Boolean(
    process.env.ZOHO_CRM_ACCOUNTS_URL &&
    process.env.ZOHO_CRM_CLIENT_ID &&
    process.env.ZOHO_CRM_CLIENT_SECRET &&
    process.env.ZOHO_CRM_REFRESH_TOKEN
  );
}

function hasExplicitCrmStaticToken() {
  return Boolean(
    process.env.ZOHO_CRM_ACCESS_TOKEN &&
    process.env.ZOHO_CRM_API_DOMAIN
  );
}

function isUsingBookingsFallback() {
  return !hasExplicitCrmRefreshFlow() && !hasExplicitCrmStaticToken();
}

function hasStaticToken() {
  return Boolean(
    env('ZOHO_CRM_ACCESS_TOKEN', 'ZOHO_BOOKINGS_ACCESS_TOKEN') &&
    env('ZOHO_CRM_API_DOMAIN', 'ZOHO_BOOKINGS_API_DOMAIN')
  );
}

function ensureConfig() {
  if (!hasRefreshFlow() && !hasStaticToken()) {
    throw new Error(
      'Zoho CRM auth config missing. Set either ZOHO_CRM_ACCESS_TOKEN + ZOHO_CRM_API_DOMAIN, ' +
      'or ZOHO_CRM_ACCOUNTS_URL + ZOHO_CRM_CLIENT_ID + ZOHO_CRM_CLIENT_SECRET + ZOHO_CRM_REFRESH_TOKEN.'
    );
  }
}

async function refreshAccessToken() {
  const accountsUrl = String(env('ZOHO_CRM_ACCOUNTS_URL', 'ZOHO_ACCOUNTS_URL') || '').replace(/\/$/, '');
  const body = new URLSearchParams({
    refresh_token: env('ZOHO_CRM_REFRESH_TOKEN', 'ZOHO_BOOKINGS_REFRESH_TOKEN'),
    client_id: env('ZOHO_CRM_CLIENT_ID', 'ZOHO_BOOKINGS_CLIENT_ID'),
    client_secret: env('ZOHO_CRM_CLIENT_SECRET', 'ZOHO_BOOKINGS_CLIENT_SECRET'),
    grant_type: 'refresh_token',
  });

  const response = await axios.post(`${accountsUrl}/oauth/v2/token`, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  });

  const accessToken = response.data?.access_token;
  const apiDomain = response.data?.api_domain || env('ZOHO_CRM_API_DOMAIN', 'ZOHO_BOOKINGS_API_DOMAIN');
  if (!accessToken || !apiDomain) {
    throw new Error('Zoho CRM token refresh failed: missing access_token or api_domain');
  }

  cachedAccessToken = accessToken;
  cachedApiDomain = apiDomain;
  const expiresInSeconds = Number(response.data?.expires_in || 0);
  const expiresInMs = Math.max((expiresInSeconds * 1000) - 60_000, 60_000);
  tokenExpiresAt = Date.now() + expiresInMs;

  logDebug('auth.refresh.success', {
    apiDomain: cachedApiDomain,
    token: maskSecret(cachedAccessToken),
    expiresAt: new Date(tokenExpiresAt).toISOString(),
  });

  return { accessToken: cachedAccessToken, apiDomain: cachedApiDomain };
}

async function getAccessToken() {
  if (hasRefreshFlow()) {
    if (cachedAccessToken && cachedApiDomain && Date.now() < tokenExpiresAt) {
      return { accessToken: cachedAccessToken, apiDomain: cachedApiDomain };
    }
    return refreshAccessToken();
  }

  const accessToken = env('ZOHO_CRM_ACCESS_TOKEN', 'ZOHO_BOOKINGS_ACCESS_TOKEN');
  const apiDomain = env('ZOHO_CRM_API_DOMAIN', 'ZOHO_BOOKINGS_API_DOMAIN');
  if (!accessToken || !apiDomain) {
    throw new Error('Zoho CRM static token config is incomplete');
  }

  logDebug('auth.static', { apiDomain, token: maskSecret(accessToken) });
  return { accessToken, apiDomain };
}

function splitName(fullName) {
  const text = String(fullName || '').trim();
  if (!text) {
    return { firstName: '', lastName: 'Lead' };
  }
  const parts = text.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: '', lastName: parts[0] };
  }
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
}

function setConfiguredFieldValue(payload, fieldApiName, value) {
  const apiName = String(fieldApiName || '').trim();
  const normalizedValue = String(value || '').trim();

  if (!apiName || !normalizedValue) {
    return;
  }

  payload[apiName] = normalizedValue;
}

function setPlatformSourceField(payload, platformSource) {
  const fieldApiName = String(
    process.env.ZOHO_CRM_PLATFORM_SOURCE_FIELD_API_NAME ||
    'Platform_Source'
  ).trim();
  const normalizedValue = String(platformSource || 'Website').trim();

  if (!fieldApiName || !normalizedValue) {
    return;
  }

  payload[fieldApiName] = normalizedValue;
}

function normalizeAttributionValue(value) {
  const text = String(value || '').trim();
  return text || undefined;
}

function getPreferredGoogleClickId(attribution) {
  if (!attribution) {
    return undefined;
  }

  return attribution.gclid || attribution.gbraid || attribution.wbraid || undefined;
}

function normalizeGoogleAdsAttribution(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const normalized = {
    gclid: normalizeAttributionValue(raw.gclid),
    gbraid: normalizeAttributionValue(raw.gbraid),
    wbraid: normalizeAttributionValue(raw.wbraid),
    campaignId: normalizeAttributionValue(raw.campaignId),
    adGroupId: normalizeAttributionValue(raw.adGroupId),
    creativeId: normalizeAttributionValue(raw.creativeId),
    targetId: normalizeAttributionValue(raw.targetId),
    device: normalizeAttributionValue(raw.device),
    network: normalizeAttributionValue(raw.network),
    matchType: normalizeAttributionValue(raw.matchType),
    utmSource: normalizeAttributionValue(raw.utmSource),
    utmMedium: normalizeAttributionValue(raw.utmMedium),
    utmCampaign: normalizeAttributionValue(raw.utmCampaign),
    utmTerm: normalizeAttributionValue(raw.utmTerm),
    utmContent: normalizeAttributionValue(raw.utmContent),
    landingPage: normalizeAttributionValue(raw.landingPage),
    firstCapturedAt: normalizeAttributionValue(raw.firstCapturedAt),
    lastCapturedAt: normalizeAttributionValue(raw.lastCapturedAt),
  };

  const clickIdType =
    normalizeAttributionValue(raw.clickIdType) ||
    (normalized.gclid ? 'gclid' : normalized.gbraid ? 'gbraid' : normalized.wbraid ? 'wbraid' : undefined);

  if (clickIdType) {
    normalized.clickIdType = clickIdType;
    normalized.hasGoogleAdsClick = true;
  }

  const hasValues = Object.values(normalized).some((value) => value !== undefined && value !== null && value !== false);
  return hasValues ? normalized : null;
}

function applyGoogleAdsAttributionFields(payload, attribution) {
  const normalizedAttribution = normalizeGoogleAdsAttribution(attribution);
  if (!normalizedAttribution) {
    return null;
  }

  const googleLeadId = getPreferredGoogleClickId(normalizedAttribution);

  // ==========================================
  // HARDCODED CUSTOM ZOHO FIELDS
  // ==========================================
  // Pushing gclid directly to 'Lead_Identifier'
  setConfiguredFieldValue(payload, 'GCL_ID', normalizedAttribution.gclid);
  
  // Pushing campaignId directly to 'Ad_Campaign'
  setConfiguredFieldValue(payload, 'GCampaignID', normalizedAttribution.campaignId);
  // ==========================================

  // (Optional) The rest remain mapped via env variables if you ever decide to use them, 
  // but you can safely delete any you aren't using in your Zoho setup.
  setConfiguredFieldValue(
    payload,
    process.env.ZOHO_CRM_GOOGLE_LEAD_ID_FIELD_API_NAME,
    googleLeadId,
  );
  setConfiguredFieldValue(
    payload,
    process.env.ZOHO_CRM_GOOGLE_LEAD_ID_TYPE_FIELD_API_NAME,
    normalizedAttribution.clickIdType,
  );
  setConfiguredFieldValue(payload, process.env.ZOHO_CRM_GBRAID_FIELD_API_NAME, normalizedAttribution.gbraid);
  setConfiguredFieldValue(payload, process.env.ZOHO_CRM_WBRAID_FIELD_API_NAME, normalizedAttribution.wbraid);
  setConfiguredFieldValue(
    payload,
    process.env.ZOHO_CRM_GOOGLE_ADS_ADGROUP_ID_FIELD_API_NAME,
    normalizedAttribution.adGroupId,
  );
  setConfiguredFieldValue(
    payload,
    process.env.ZOHO_CRM_GOOGLE_ADS_CREATIVE_ID_FIELD_API_NAME,
    normalizedAttribution.creativeId,
  );
  setConfiguredFieldValue(
    payload,
    process.env.ZOHO_CRM_GOOGLE_ADS_TARGET_ID_FIELD_API_NAME,
    normalizedAttribution.targetId,
  );
  setConfiguredFieldValue(
    payload,
    process.env.ZOHO_CRM_GOOGLE_ADS_DEVICE_FIELD_API_NAME,
    normalizedAttribution.device,
  );
  setConfiguredFieldValue(
    payload,
    process.env.ZOHO_CRM_GOOGLE_ADS_NETWORK_FIELD_API_NAME,
    normalizedAttribution.network,
  );
  setConfiguredFieldValue(
    payload,
    process.env.ZOHO_CRM_GOOGLE_ADS_MATCHTYPE_FIELD_API_NAME,
    normalizedAttribution.matchType,
  );
  setConfiguredFieldValue(
    payload,
    process.env.ZOHO_CRM_GOOGLE_ADS_UTM_SOURCE_FIELD_API_NAME,
    normalizedAttribution.utmSource,
  );
  setConfiguredFieldValue(
    payload,
    process.env.ZOHO_CRM_GOOGLE_ADS_UTM_MEDIUM_FIELD_API_NAME,
    normalizedAttribution.utmMedium,
  );
  setConfiguredFieldValue(
    payload,
    process.env.ZOHO_CRM_GOOGLE_ADS_UTM_CAMPAIGN_FIELD_API_NAME,
    normalizedAttribution.utmCampaign,
  );
  setConfiguredFieldValue(
    payload,
    process.env.ZOHO_CRM_GOOGLE_ADS_LANDING_PAGE_FIELD_API_NAME,
    normalizedAttribution.landingPage,
  );

  return normalizedAttribution;
}
function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }

  const seen = new Set();
  const normalizedTags = [];

  for (const item of tags) {
    const name = String(item || '').trim();
    const key = name.toLowerCase();

    if (!name || seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalizedTags.push(name);
  }

  return normalizedTags;
}

function getTagsSettingsEndpoint(apiDomain, apiVersion) {
  return `${String(apiDomain).replace(/\/$/, '')}/crm/${apiVersion}/settings/tags`;
}

function getTagScopeHints(operation) {
  return [
    'ZohoCRM.settings.ALL',
    `ZohoCRM.settings.tags.${operation}`,
  ];
}

function buildTagScopeMismatchError({ endpoint, moduleApiName, operation, status, responseData }) {
  const scopeHints = getTagScopeHints(operation);

  logDebug('tag.scope_mismatch', {
    endpoint,
    moduleApiName,
    operation,
    status,
    responseData,
    scopeHints,
  });

  const error = new Error(
    `Zoho CRM tag scope mismatch: generate a CRM token with ${scopeHints.join(', ')} scopes.`,
  );
  error.code = 'ZOHO_CRM_TAG_SCOPE_MISMATCH';
  error.details = {
    moduleApiName,
    operation,
    status,
    response: responseData,
    scopeHints,
  };
  return error;
}

function maybeThrowTagScopeMismatch({ error, endpoint, moduleApiName, operation }) {
  const status = Number(error?.response?.status || 0);
  const responseData = error?.response?.data || null;
  const errorCode = responseData?.code || null;

  if (status === 401 && errorCode === 'OAUTH_SCOPE_MISMATCH') {
    throw buildTagScopeMismatchError({
      endpoint,
      moduleApiName,
      operation,
      status,
      responseData,
    });
  }
}

async function getModuleTags({
  accessToken,
  apiDomain,
  apiVersion,
  moduleApiName,
}) {
  const endpoint = getTagsSettingsEndpoint(apiDomain, apiVersion);

  let response;
  try {
    response = await axios.get(endpoint, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
      params: {
        module: moduleApiName,
      },
      timeout: 20000,
    });
  } catch (error) {
    maybeThrowTagScopeMismatch({
      error,
      endpoint,
      moduleApiName,
      operation: 'READ',
    });
    throw error;
  }

  return Array.isArray(response?.data?.tags) ? response.data.tags : [];
}

async function createModuleTags({
  accessToken,
  apiDomain,
  apiVersion,
  moduleApiName,
  tags,
}) {
  const endpoint = getTagsSettingsEndpoint(apiDomain, apiVersion);

  try {
    await axios.post(
      endpoint,
      {
        tags: tags.map((name) => ({ name })),
      },
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json',
        },
        params: {
          module: moduleApiName,
        },
        timeout: 20000,
      },
    );
  } catch (error) {
    maybeThrowTagScopeMismatch({
      error,
      endpoint,
      moduleApiName,
      operation: 'CREATE',
    });

    const status = Number(error?.response?.status || 0);
    const responseData = error?.response?.data || null;
    const errorCode = responseData?.code || null;
    const duplicateLikeError =
      status === 400 &&
      (errorCode === 'DUPLICATE_DATA' || errorCode === 'INVALID_DATA' || errorCode === 'PATTERN_NOT_MATCHED');

    if (!duplicateLikeError) {
      throw error;
    }
  }
}

async function ensureModuleTags({
  accessToken,
  apiDomain,
  apiVersion,
  moduleApiName,
  tagNames,
}) {
  const normalizedTagNames = normalizeTags(tagNames);
  if (!normalizedTagNames.length) {
    return [];
  }

  let availableTags = await getModuleTags({
    accessToken,
    apiDomain,
    apiVersion,
    moduleApiName,
  });

  const availableTagMap = new Map(
    availableTags.map((tag) => [String(tag?.name || '').trim().toLowerCase(), tag]),
  );

  const missingTags = normalizedTagNames.filter((name) => !availableTagMap.has(name.toLowerCase()));

  if (missingTags.length) {
    await createModuleTags({
      accessToken,
      apiDomain,
      apiVersion,
      moduleApiName,
      tags: missingTags,
    });

    availableTags = await getModuleTags({
      accessToken,
      apiDomain,
      apiVersion,
      moduleApiName,
    });
  }

  const refreshedTagMap = new Map(
    availableTags.map((tag) => [String(tag?.name || '').trim().toLowerCase(), tag]),
  );

  return normalizedTagNames.map((name) => {
    const tag = refreshedTagMap.get(name.toLowerCase());
    if (!tag?.name) {
      throw new Error(`Zoho CRM tag "${name}" could not be created or loaded.`);
    }

    return {
      name: tag.name,
      id: tag.id,
      color_code: tag.color_code || undefined,
    };
  });
}

async function addTagsToRecord({
  accessToken,
  apiDomain,
  apiVersion,
  moduleApiName,
  recordId,
  tags,
}) {
  if (!recordId) {
    return;
  }

  const normalizedTags = normalizeTags(tags);
  if (!normalizedTags.length) {
    return;
  }

  const resolvedTags = await ensureModuleTags({
    accessToken,
    apiDomain,
    apiVersion,
    moduleApiName,
    tagNames: normalizedTags,
  });

  const endpoint = `${String(apiDomain).replace(/\/$/, '')}/crm/${apiVersion}/${moduleApiName}/${recordId}/actions/add_tags`;

  let response;
  try {
    response = await axios.post(
      endpoint,
      {
        tags: resolvedTags,
      },
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      },
    );
  } catch (error) {
    maybeThrowScopeMismatch({
      error,
      endpoint,
      moduleApiName,
      scopeHints: getScopeHints(moduleApiName),
    });
    throw error;
  }

  const addTagsResult = response?.data?.data?.[0];
  if (!addTagsResult || addTagsResult.status !== 'success') {
    const reason = addTagsResult?.message || 'Zoho CRM add tags failed';
    const error = new Error(reason);
    error.code = 'ZOHO_CRM_ADD_TAGS_FAILED';
    error.details = response?.data || null;
    throw error;
  }
}

function buildLeadPayload({
  name,
  phone,
  email,
  project,
  source,
  platformSource,
  platform_source,
  leadStatus,
  preferredDate,
  pickupAddress,
  requirements,
  notes,
  tags,
  googleAdsAttribution,
}) {
  const { firstName, lastName } = splitName(name);
  const company = String(
    process.env.ZOHO_CRM_DEFAULT_COMPANY ||
    `Easy Homes - ${String(project || 'Website Lead').trim()}`
  ).trim();

  const payload = {
    Last_Name: lastName || 'Lead',
    Company: company || 'Easy Homes',
    Lead_Source: String(source || 'Website').trim(),
    Phone: String(phone || '').trim(),
    Mobile: String(phone || '').trim(),
  };

  setPlatformSourceField(payload, platformSource || platform_source || 'Website');

  if (firstName) payload.First_Name = firstName;
  if (email) payload.Email = String(email).trim();
  if (leadStatus) payload.Lead_Status = String(leadStatus).trim();

  const normalizedRequirements = String(requirements || '').trim();
  if (normalizedRequirements) {
    setConfiguredFieldValue(
      payload,
      process.env.ZOHO_CRM_REQUIREMENTS_FIELD_API_NAME,
      normalizedRequirements,
    );
  }

  const normalizedGoogleAdsAttribution = applyGoogleAdsAttributionFields(payload, googleAdsAttribution);

  // =========================================================================
  // EXPLICIT MAPPING FOR CUSTOM FIELDS: Ad_Campaign and Lead_Identifier
  // =========================================================================
  // =========================================================================

  const descriptionBits = [];
  if (project) descriptionBits.push(`Project: ${String(project).trim()}`);
  if (preferredDate) descriptionBits.push(`Preferred Date: ${String(preferredDate).trim()}`);
  if (pickupAddress) descriptionBits.push(`Pickup Address: ${String(pickupAddress).trim()}`);
  if (normalizedRequirements) descriptionBits.push(`Requirements: ${normalizedRequirements}`);
  if (notes) descriptionBits.push(`Notes: ${String(notes).trim()}`);
  if (normalizedGoogleAdsAttribution?.clickIdType) {
    descriptionBits.push(`Google Ads Click ID Type: ${normalizedGoogleAdsAttribution.clickIdType}`);
  }
  if (normalizedGoogleAdsAttribution?.gclid) {
    descriptionBits.push(`GCLID: ${normalizedGoogleAdsAttribution.gclid}`);
  }
  if (normalizedGoogleAdsAttribution?.gbraid) {
    descriptionBits.push(`GBRAID: ${normalizedGoogleAdsAttribution.gbraid}`);
  }
  if (normalizedGoogleAdsAttribution?.wbraid) {
    descriptionBits.push(`WBRAID: ${normalizedGoogleAdsAttribution.wbraid}`);
  }
  if (normalizedGoogleAdsAttribution?.campaignId) {
    descriptionBits.push(`Google Ads Campaign ID: ${normalizedGoogleAdsAttribution.campaignId}`);
  }
  if (normalizedGoogleAdsAttribution?.adGroupId) {
    descriptionBits.push(`Google Ads Ad Group ID: ${normalizedGoogleAdsAttribution.adGroupId}`);
  }
  if (normalizedGoogleAdsAttribution?.creativeId) {
    descriptionBits.push(`Google Ads Creative ID: ${normalizedGoogleAdsAttribution.creativeId}`);
  }
  if (normalizedGoogleAdsAttribution?.targetId) {
    descriptionBits.push(`Google Ads Target ID: ${normalizedGoogleAdsAttribution.targetId}`);
  }
  if (normalizedGoogleAdsAttribution?.device) {
    descriptionBits.push(`Google Ads Device: ${normalizedGoogleAdsAttribution.device}`);
  }
  if (normalizedGoogleAdsAttribution?.network) {
    descriptionBits.push(`Google Ads Network: ${normalizedGoogleAdsAttribution.network}`);
  }
  if (normalizedGoogleAdsAttribution?.matchType) {
    descriptionBits.push(`Google Ads Match Type: ${normalizedGoogleAdsAttribution.matchType}`);
  }
  if (normalizedGoogleAdsAttribution?.utmCampaign) {
    descriptionBits.push(`UTM Campaign: ${normalizedGoogleAdsAttribution.utmCampaign}`);
  }
  if (normalizedGoogleAdsAttribution?.landingPage) {
    descriptionBits.push(`Landing Page: ${normalizedGoogleAdsAttribution.landingPage}`);
  }
  if (normalizedGoogleAdsAttribution?.firstCapturedAt) {
    descriptionBits.push(`Attribution Captured At: ${normalizedGoogleAdsAttribution.firstCapturedAt}`);
  }
  if (descriptionBits.length) payload.Description = descriptionBits.join('\n');
  payload.__normalizedTags = normalizeTags(tags);

  return payload;
}

const LEAD_STATUS_PRIORITY = Object.freeze({
  'Downloaded Brochure': 10,
  'Downloaded Layout': 10,
  'Requested Callback': 15,
  'Callback Requested': 15,
  'Visit Scheduled': 20,
});

function getScopeHints(moduleApiName) {
  const moduleName = String(moduleApiName || 'Leads').trim();
  const lower = moduleName.toLowerCase();
  return [
    `ZohoCRM.modules.${lower}.READ`,
    `ZohoCRM.modules.${lower}.CREATE`,
    `ZohoCRM.modules.${lower}.WRITE`,
    'ZohoCRM.modules.ALL',
  ];
}

function resolveLeadStatus(existingStatus, incomingStatus) {
  const current = String(existingStatus || '').trim();
  const next = String(incomingStatus || '').trim();

  if (!current) return next;
  if (!next) return current;

  const currentPriority = LEAD_STATUS_PRIORITY[current] || 0;
  const nextPriority = LEAD_STATUS_PRIORITY[next] || 0;
  if (nextPriority >= currentPriority) return next;
  return current;
}

function escapeCriteriaValue(rawValue) {
  return String(rawValue || '')
    .replace(/\\/g, '\\\\')
    .replace(/([(),:])/g, '\\$1');
}

function buildScopeMismatchError({ endpoint, moduleApiName, scopeHints, status, responseData }) {
  const errorCode = responseData?.code || null;
  const remediation = [
    'Generate a new Zoho CRM refresh token with CRM Leads scopes.',
    `Required scope examples: ${scopeHints.join(', ')}.`,
    'Set explicit CRM env vars: ZOHO_CRM_ACCOUNTS_URL, ZOHO_CRM_CLIENT_ID, ZOHO_CRM_CLIENT_SECRET, ZOHO_CRM_REFRESH_TOKEN.',
    isUsingBookingsFallback()
      ? 'Current setup is using Zoho Bookings OAuth fallback, which usually lacks CRM module scopes.'
      : null,
  ].filter(Boolean).join(' ');

  logDebug('lead.scope_mismatch', {
    endpoint,
    moduleApiName,
    status,
    errorCode,
    scopeHints,
    usingBookingsFallback: isUsingBookingsFallback(),
  });

  const scopeError = new Error(`Zoho CRM scope mismatch: ${remediation}`);
  scopeError.code = 'ZOHO_CRM_SCOPE_MISMATCH';
  scopeError.details = {
    status,
    response: responseData,
    scopeHints,
    usingBookingsFallback: isUsingBookingsFallback(),
  };
  return scopeError;
}

function maybeThrowScopeMismatch({ error, endpoint, moduleApiName, scopeHints }) {
  const status = Number(error?.response?.status || 0);
  const responseData = error?.response?.data || null;
  const errorCode = responseData?.code || null;
  if (status === 401 && errorCode === 'OAUTH_SCOPE_MISMATCH') {
    throw buildScopeMismatchError({
      endpoint,
      moduleApiName,
      scopeHints,
      status,
      responseData,
    });
  }
}

async function findExistingLeadByPhone({
  endpoint,
  accessToken,
  moduleApiName,
  scopeHints,
  phone,
}) {
  const rawPhone = String(phone || '').trim();
  if (!rawPhone) return null;

  const digitsOnly = rawPhone.replace(/\D/g, '');
  const candidateValues = [];
  for (const value of [rawPhone, digitsOnly]) {
    if (value && !candidateValues.includes(value)) {
      candidateValues.push(value);
    }
  }

  const searchEndpoint = `${endpoint}/search`;
  const attempts = [];
  for (const value of candidateValues) {
    attempts.push({ mode: 'phone', query: value, params: { phone: value } });
  }
  for (const value of candidateValues) {
    attempts.push({
      mode: 'criteria_phone',
      query: value,
      params: { criteria: `(Phone:equals:${escapeCriteriaValue(value)})` },
    });
  }
  for (const value of candidateValues) {
    attempts.push({
      mode: 'criteria_mobile',
      query: value,
      params: { criteria: `(Mobile:equals:${escapeCriteriaValue(value)})` },
    });
  }

  for (const attempt of attempts) {
    try {
      logDebug('lead.search.request', {
        endpoint: searchEndpoint,
        mode: attempt.mode,
        query: attempt.query,
      });

      const response = await axios.get(searchEndpoint, {
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
        },
        params: attempt.params,
        timeout: 20000,
      });

      const records = Array.isArray(response?.data?.data) ? response.data.data : [];
      if (!records.length) {
        logDebug('lead.search.empty', {
          endpoint: searchEndpoint,
          mode: attempt.mode,
          query: attempt.query,
          status: response.status,
        });
        continue;
      }

      if (records.length > 1) {
        logDebug('lead.search.duplicates_found', {
          endpoint: searchEndpoint,
          mode: attempt.mode,
          query: attempt.query,
          count: records.length,
        });
      }

      const firstRecord = records[0] || null;
      if (firstRecord?.id) {
        logDebug('lead.search.hit', {
          endpoint: searchEndpoint,
          mode: attempt.mode,
          query: attempt.query,
          id: firstRecord.id,
        });
        return firstRecord;
      }
    } catch (error) {
      maybeThrowScopeMismatch({
        error,
        endpoint: searchEndpoint,
        moduleApiName,
        scopeHints,
      });

      const status = Number(error?.response?.status || 0);
      const responseData = error?.response?.data || null;
      const errorCode = responseData?.code || null;
      const isNoContent = status === 204 || status === 404 || errorCode === 'NO_CONTENT';
      const canTryNextAttempt = status === 400 && (errorCode === 'INVALID_QUERY' || errorCode === 'INVALID_DATA');

      if (isNoContent || canTryNextAttempt) {
        logDebug('lead.search.skip_attempt', {
          endpoint: searchEndpoint,
          mode: attempt.mode,
          query: attempt.query,
          status,
          errorCode,
        });
        continue;
      }

      throw error;
    }
  }

  return null;
}

async function createZohoCrmLead(input) {
  if (!isEnabled()) {
    logDebug('lead.skip.disabled');
    return null;
  }

  ensureConfig();
  const { accessToken, apiDomain } = await getAccessToken();
  const moduleApiName = process.env.ZOHO_CRM_MODULE || 'Leads';
  const apiVersion = String(process.env.ZOHO_CRM_API_VERSION || 'v8').trim();
  const endpoint = `${String(apiDomain).replace(/\/$/, '')}/crm/${apiVersion}/${moduleApiName}`;
  const rawLeadPayload = buildLeadPayload(input || {});
  const recordTags = Array.isArray(rawLeadPayload.__normalizedTags) ? rawLeadPayload.__normalizedTags : [];
  const { __normalizedTags, ...leadPayload } = rawLeadPayload;
  const scopeHints = getScopeHints(moduleApiName);

  logDebug('lead.upsert.start', {
    endpoint,
    moduleApiName,
    payload: leadPayload,
  });

  const existingLead = await findExistingLeadByPhone({
    endpoint,
    accessToken,
    moduleApiName,
    scopeHints,
    phone: leadPayload.Phone,
  });

  if (existingLead?.id) {
    const mergedStatus = resolveLeadStatus(existingLead.Lead_Status, leadPayload.Lead_Status);
    const updatePayload = {
      id: existingLead.id,
      ...leadPayload,
    };
    if (mergedStatus) {
      updatePayload.Lead_Status = mergedStatus;
    } else {
      delete updatePayload.Lead_Status;
    }

    logDebug('lead.update.request', {
      endpoint,
      moduleApiName,
      existingId: existingLead.id,
      payload: updatePayload,
    });

    let updateResponse;
    try {
      updateResponse = await axios.put(
        endpoint,
        { data: [updatePayload] },
        {
          headers: {
            Authorization: `Zoho-oauthtoken ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        }
      );
    } catch (error) {
      maybeThrowScopeMismatch({
        error,
        endpoint,
        moduleApiName,
        scopeHints,
      });
      throw error;
    }

    const updateResult = updateResponse.data?.data?.[0];
    if (!updateResult || updateResult.status !== 'success') {
      const reason = updateResult?.message || 'Zoho CRM lead update failed';
      const error = new Error(reason);
      error.code = 'ZOHO_CRM_LEAD_UPDATE_FAILED';
      error.details = updateResponse.data || null;
      throw error;
    }

    await addTagsToRecord({
      accessToken,
      apiDomain,
      apiVersion,
      moduleApiName,
      recordId: existingLead.id,
      tags: recordTags,
    });

    logDebug('lead.update.success', { id: existingLead.id });
    return updateResponse.data;
  }

  logDebug('lead.create.request', {
    endpoint,
    moduleApiName,
    payload: leadPayload,
  });

  let createResponse;
  try {
    createResponse = await axios.post(
      endpoint,
      { data: [leadPayload] },
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      }
    );
  } catch (error) {
    maybeThrowScopeMismatch({
      error,
      endpoint,
      moduleApiName,
      scopeHints,
    });
    throw error;
  }

  const createResult = createResponse.data?.data?.[0];
  if (!createResult || createResult.status !== 'success') {
    const reason = createResult?.message || 'Zoho CRM lead creation failed';
    const error = new Error(reason);
    error.code = 'ZOHO_CRM_LEAD_FAILED';
    error.details = createResponse.data || null;
    throw error;
  }

  const createdRecordId = createResult.details?.id || null;
  await addTagsToRecord({
    accessToken,
    apiDomain,
    apiVersion,
    moduleApiName,
    recordId: createdRecordId,
    tags: recordTags,
  });

  logDebug('lead.create.success', { id: createdRecordId });
  return createResponse.data;
}

module.exports = {
  createZohoCrmLead,
  isZohoCrmStrictMode: isStrictMode,
};
