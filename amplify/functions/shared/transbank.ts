import {
  WebpayPlus,
  Options,
  IntegrationCommerceCodes,
  IntegrationApiKeys,
  Environment,
} from "transbank-sdk";

export function createTbTransaction(commerceCode: string, apiKey: string, env: string) {
  if (env === "production") {
    return new WebpayPlus.Transaction(
      new Options(commerceCode, apiKey, Environment.Production)
    );
  }
  return new WebpayPlus.Transaction(
    new Options(
      IntegrationCommerceCodes.WEBPAY_PLUS,
      IntegrationApiKeys.WEBPAY,
      Environment.Integration
    )
  );
}
