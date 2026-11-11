const { parsePhoneNumberFromString } = require("libphonenumber-js");

const GENERATE_URL =
  process.env.ARKESEL_OTP_GENERATE_URL ||
  "https://sms.arkesel.com/api/otp/generate";
const VERIFY_URL =
  process.env.ARKESEL_OTP_VERIFY_URL ||
  "https://sms.arkesel.com/api/otp/verify";

const normalizeArkeselNumber = (phoneNumber) => {
  const parsed = parsePhoneNumberFromString(String(phoneNumber).trim());
  if (parsed?.isValid()) return parsed.number.slice(1);

  const digits = String(phoneNumber).trim().replace(/^\+/, "");
  if (/^[1-9]\d{9,14}$/.test(digits)) return digits;
  throw new Error(
    "Enter the full international phone number with country code, for example +233XXXXXXXXX",
  );
};

const requestArkeselOtp = async (endpoint, payload, expectedCode) => {
  const apiKey = process.env.ARKESEL_API_KEY;
  if (!apiKey) throw new Error("Arkesel API key is not configured");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`Arkesel returned an invalid response (${response.status})`);
  }
  if (!data || typeof data !== "object") {
    throw new Error(`Arkesel returned an invalid response (${response.status})`);
  }

  if (!response.ok || String(data.code) !== expectedCode) {
    const providerMessage =
      typeof data.message === "string" ? `: ${data.message}` : "";
    const error = new Error(
      `Arkesel request failed (${response.status}, code ${data.code ?? "unknown"})${providerMessage}`,
    );
    error.providerRejected =
      response.ok || ["1104", "1105"].includes(String(data.code));
    throw error;
  }

  return data;
};

const sendSmsOtp = async (phoneNumber) => {
  const senderId = process.env.ARKESEL_SENDER_ID;
  if (!senderId) throw new Error("Arkesel SMS sender ID is not configured");

  return requestArkeselOtp(
    GENERATE_URL,
    {
      expiry: 5,
      length: 6,
      medium: "sms",
      message: "Your LinkApp verification code is %otp_code%",
      number: normalizeArkeselNumber(phoneNumber),
      sender_id: senderId,
      type: "numeric",
    },
    "1000",
  );
};

const verifyOtp = async (phoneNumber, code) =>
  requestArkeselOtp(
    VERIFY_URL,
    {
      code: String(code).trim(),
      number: normalizeArkeselNumber(phoneNumber),
    },
    "1100",
  );

module.exports = { sendSmsOtp, verifyOtp, normalizeArkeselNumber };
