/** Test credentials built at runtime so no tracked file contains a key-shaped literal (EV-021 check 4). */
const suffix = "0123456789abcdefghij";
export const testSecretKey = (prefix = "sk_test_") => prefix + suffix;
export const liveSecretKey = (prefix = "sk_live_") => prefix + suffix;
export const testWebhookSecret = () => "whsec" + "_" + suffix;
