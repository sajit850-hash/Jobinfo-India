# Integration adapters — vendor-independent setup

Jobinfo India uses provider contracts under `apps/api/src/integrations/`. Business routes call the contracts, not vendor SDKs. This lets the business select vendors later without changing candidate, recruiter, billing or application workflows.

## Development defaults

- SMS: `OTP_PROVIDER=console` selects the local SMS adapter. Registration and login do not invoke SMS or OTP.
- Email: `EMAIL_PROVIDER=console`; reset-link previews are printed locally.
- Payments: `PAYMENT_PROVIDER=mock`; checkout creates a test transaction and a development-only confirmation route. It never charges money.
- Resume storage: provider contract is defined; register a private local adapter for development or S3-compatible adapter for production before enabling uploads.
- ATS: keyword-overlap baseline is available now. `AI_PROVIDER` is reserved for a later model adapter. No claim of AI inference is made until a model is connected and evaluated.

## Add a real provider

1. Implement the corresponding interface in `apps/api/src/integrations/contracts.ts`.
2. Register the implementation during API startup in `apps/api/src/integrations/registry.ts`.
3. Read credentials only from environment variables or a secret manager. Never commit keys.
4. Add provider-specific unit tests and webhook signature tests.
5. Keep local/test and production modes separate. Do not allow mock providers in production.

## Configuration matrix

| Capability | Environment | Current mode | Later vendor adapter |
|---|---|---|---|
| SMS messaging | `OTP_PROVIDER` | Console/dev | MSG91, Twilio, etc. |
| Email and password recovery | `EMAIL_PROVIDER` | Console/dev | SMTP, SES, SendGrid |
| Payments | `PAYMENT_PROVIDER` | Mock/dev | Razorpay, Cashfree, Stripe |
| Resume storage | storage adapter registration | Not enabled | S3-compatible private bucket |
| AI matching | `AI_PROVIDER` | Keyword baseline | OpenAI or another evaluated model |

Production startup must use real adapters for customer-facing SMS/email/payment/storage. Development-only mock confirmation routes are not registered in production.
