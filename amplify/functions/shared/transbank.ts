import {
  WebpayPlus,
  Options,
  IntegrationCommerceCodes,
  IntegrationApiKeys,
  Environment,
} from "transbank-sdk";

// ─── Singleton — reutilizado entre warm starts ────────────────────────────────
// Se inicializa una sola vez al cargar el módulo.
// TRANSBANK_ENV se lee en frío; en integration se ignoran COMMERCE_CODE/WEBPAY_API_KEY.

const TRANSBANK_ENV  = process.env.TRANSBANK_ENV!;
const COMMERCE_CODE  = process.env.COMMERCE_CODE!;
const WEBPAY_API_KEY = process.env.WEBPAY_API_KEY!;

export const tbTransaction =
  TRANSBANK_ENV === "production"
    ? new WebpayPlus.Transaction(
        new Options(COMMERCE_CODE, WEBPAY_API_KEY, Environment.Production)
      )
    : new WebpayPlus.Transaction(
        new Options(
          IntegrationCommerceCodes.WEBPAY_PLUS,
          IntegrationApiKeys.WEBPAY,
          Environment.Integration
        )
      );
