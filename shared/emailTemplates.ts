/** Chaves de `Setting` usadas na aba E-mail do admin. */
export const EMAIL_SETTING_KEYS = [
  'resend_api_key',
  'sender_name',
  'sender_email',
  'welcome_template_pt',
  'reset_template_pt',
  'welcome_template_es',
  'reset_template_es',
] as const;

export type EmailSettingKey = (typeof EMAIL_SETTING_KEYS)[number];

export type EmailLang = 'pt' | 'es';

/** Texto editável — recuperação de senha (PT). Placeholders: {{name}}, {{reset_link}} */
export const DEFAULT_RESET_BODY_PT = `Olá, {{name}}!

Recebemos uma solicitação para redefinir a senha da sua conta na área de membros. Use o botão abaixo para escolher uma nova senha. O link expira em 1 hora.

Se você não fez este pedido, ignore este e-mail — sua senha continua a mesma.`;

/** Texto editável — boas-vindas (PT). Placeholders: {{name}}, {{email}}, {{password}}, {{app_url}} */
export const DEFAULT_WELCOME_BODY_PT = `Olá, {{name}}!

Parabéns por adquirir nossa licença. Seu acesso à área de membros já está liberado.

Login: {{email}}
Senha: {{password}}

Acesse sua área de membros: {{app_url}}

Qualquer dúvida, entre em contato com nosso suporte.`;

/** Texto editável — boas-vindas (ES). Placeholders: {{name}}, {{email}}, {{password}}, {{app_url}} */
export const DEFAULT_WELCOME_BODY_ES = `¡Hola, {{name}}!

Felicitaciones por adquirir nuestra licencia. Tu acceso al área de miembros ya está activo.

Usuario: {{email}}
Contraseña: {{password}}

Accede al área de miembros: {{app_url}}

Si tienes dudas, contacta con nuestro soporte.`;

const RESET_LABELS: Record<EmailLang, { badge: string; button: string; altLink: string; footer: string }> = {
  pt: {
    badge: 'Recuperação de senha',
    button: 'Redefinir minha senha',
    altLink: 'Link alternativo',
    footer: 'Forex Rendimento · Mensagem automática, por favor não responda.',
  },
  es: {
    badge: 'Recuperación de contraseña',
    button: 'Restablecer contraseña',
    altLink: 'Enlace alternativo',
    footer: 'Forex Rendimento · Mensaje automático, no responda.',
  },
};

const WELCOME_LABELS: Record<EmailLang, { button: string; altLink: string; footer: string }> = {
  pt: {
    button: 'Acessar área de membros',
    altLink: 'Link alternativo',
    footer: 'Forex Rendimento · Mensagem automática, por favor não responda.',
  },
  es: {
    button: 'Acceder al área de miembros',
    altLink: 'Enlace alternativo',
    footer: 'Forex Rendimento · Mensaje automático, no responda.',
  },
};

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Converte valor salvo (texto ou HTML legado) para texto simples no admin. */
export function emailBodyFromStored(value: string | null | undefined, fallback: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  if (/<[a-z][\s\S]*>/i.test(raw)) return htmlToPlainBody(raw);
  return raw;
}

function htmlToPlainBody(html: string): string {
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*/gi, '\n\n')
    .replace(/<\/div>\s*/gi, '\n')
    .replace(/<\/h[1-6]>\s*/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text || '';
}

function plainTextToParagraphsHtml(text: string): string {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (!blocks.length) return '';
  return blocks
    .map((block) => {
      const inner = escapeHtml(block).replace(/\n/g, '<br>');
      return `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#475569;">${inner}</p>`;
    })
    .join('');
}

function emailShell(contentHtml: string, footer: string): string {
  return `<div style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
          <tr>
            <td style="background:#0f172a;padding:28px 32px;text-align:center;">
              <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:-0.02em;">Forex Rendimento</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              ${contentHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="margin:0;font-size:12px;color:#94a3b8;">${escapeHtml(footer)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`;
}

/** Monta HTML completo a partir do texto editável no admin. */
export function buildResetEmailHtml(bodyPlain: string, lang: EmailLang = 'pt'): string {
  const labels = RESET_LABELS[lang];
  const paragraphs = plainTextToParagraphsHtml(bodyPlain);
  const inner = `
              <p style="margin:0 0 16px;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">${escapeHtml(labels.badge)}</p>
              ${paragraphs}
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px;">
                <tr>
                  <td style="border-radius:10px;background:#2563eb;">
                    <a href="{{reset_link}}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(labels.button)}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:12px;line-height:1.5;color:#cbd5e1;word-break:break-all;">${escapeHtml(labels.altLink)}: {{reset_link}}</p>`;
  return emailShell(inner, labels.footer);
}

/** Monta HTML completo a partir do texto editável no admin. */
export function buildWelcomeEmailHtml(bodyPlain: string, lang: EmailLang = 'pt'): string {
  const labels = WELCOME_LABELS[lang];
  const paragraphs = plainTextToParagraphsHtml(bodyPlain);
  const inner = `
              ${paragraphs}
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 24px;">
                <tr>
                  <td style="border-radius:10px;background:#2563eb;">
                    <a href="{{app_url}}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(labels.button)}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:12px;line-height:1.5;color:#64748b;word-break:break-all;">${escapeHtml(labels.altLink)}: <a href="{{app_url}}" style="color:#2563eb;text-decoration:underline;">{{app_url}}</a></p>`;
  return emailShell(inner, labels.footer);
}

/** Substitui placeholders no HTML final. */
export function applyEmailPlaceholders(
  html: string,
  vars: Record<string, string>
): string {
  let out = html;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return out;
}
