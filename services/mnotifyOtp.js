const crypto = require("node:crypto");
const { parsePhoneNumberFromString } = require("libphonenumber-js");

const DEFAULT_COUNTRY_CODE = "GH";
const SMS_URL = "https://api.mnotify.com/api/sms/quick";

const normalizePhoneNumber = (phoneNumber, countryCode = DEFAULT_COUNTRY_CODE) => {
  const input = String(phoneNumber).trim();
  if (!input) return null;

  const parsed = parsePhoneNumberFromString(input, countryCode);
  if (parsed?.isValid()) {
    return parsed.number;
  }

  const digits = input.replace(/^\+/, "").replace(/\D/g, "");
  if (/^[1-9]\d{9,14}$/.test(digits)) {
    const withCountry = parsePhoneNumberFromString(`+${digits}`);
    if (withCountry?.isValid()) {
      return withCountry.number;
    }
    const withDefault = parsePhoneNumberFromString(digits, countryCode);
    if (withDefault?.isValid()) {
      return withDefault.number;
    }
  }

  return null;
};

const normalizeMnotifyNumber = (phoneNumber, countryCode = DEFAULT_COUNTRY_CODE) => {
  const normalized = normalizePhoneNumber(phoneNumber, countryCode);
  const parsed = normalized && parsePhoneNumberFromString(normalized);
  if (!parsed) {
    throw new Error(
      "Enter a valid phone number with country code, for example +233XXXXXXXXX"
    );
  }
  if (!["GH", "SN", "CI"].includes(parsed.country)) {
    throw new Error(
      "mNotify Quick SMS does not support this destination; international SMS requires an approved template"
    );
  }
  // mNotify's Quick SMS endpoint expects locally formatted recipients.
  return parsed.formatNational().replace(/\D/g, "");
};

const generateOtp = () => String(crypto.randomInt(100000, 1000000));

const verifyOtp = (submittedCode, expectedCode) => {
  const submitted = String(submittedCode ?? "").trim();
  const expected = String(expectedCode ?? "").trim();
  if (!/^\d{6}$/.test(submitted) || !/^\d{6}$/.test(expected)) return false;
  return crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(expected));
};

const sendSmsOtp = async (phoneNumber, code, countryCode = DEFAULT_COUNTRY_CODE) => {
  const apiKey = process.env.MNOTIFY_API_KEY;
  if (!apiKey) throw new Error("mNotify API key is not configured");

  const sender = process.env.MNOTIFY_SENDER_ID;
  if (!sender) throw new Error("mNotify SMS sender ID is not configured");
  if (!/^\d{6}$/.test(String(code))) {
    throw new Error("A six-digit OTP is required");
  }

  const url = new URL(SMS_URL);
  url.searchParams.set("key", apiKey);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: [normalizeMnotifyNumber(phoneNumber, countryCode)],
      sender,
      message: `Your LinkApp verification code is ${code}. It expires in 5 minutes.`,
      is_schedule: false,
      schedule_date: "",
      sms_type: "otp",
    }),
    signal: AbortSignal.timeout(30000),
  });

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`mNotify returned an invalid response (${response.status})`);
  }
  if (!data || typeof data !== "object") {
    throw new Error(`mNotify returned an invalid response (${response.status})`);
  }

  const sentCount = Number(data.summary?.total_sent);
  if (
    !response.ok ||
    data.status !== "success" ||
    String(data.code) !== "2000" ||
    !Number.isFinite(sentCount) ||
    sentCount < 1
  ) {
    const message = [data.message, data.error, data.error_message].find(
      (value) => typeof value === "string" && value.trim()
    );
    const providerCode = data.code ?? data.error_code ?? "unknown";
    const providerMessage = message || response.statusText;
    const error = new Error(
      `mNotify SMS request failed (${response.status}, code ${providerCode})${
        providerMessage ? `: ${providerMessage}` : ""
      }`
    );
    error.providerRejected = response.status >= 400 && response.status < 500;
    throw error;
  }

  return data;
};

module.exports = {
  generateOtp,
  normalizePhoneNumber,
  normalizeMnotifyNumber,
  sendSmsOtp,
  verifyOtp,
};
