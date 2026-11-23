const suffix = "0123456789abcdefghij";
export const testSecretKey = (prefix = "sk_test_") => prefix + suffix;
export const liveSecretKey = (prefix = "sk_live_") => prefix + suffix;
export const testWebhookSecret = () => "whsec_" + suffix;
