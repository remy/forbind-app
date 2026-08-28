/**
 * The authorise sheet.
 *
 * The form is derived from the document: only the security schemes the schema
 * actually declares are offered, one scheme means no picker at all, and the
 * provenance block says where the answer came from. Nothing here is stored
 * anywhere but memory — no localStorage, no cookies — and the snippet the copy
 * button produces carries `$TOKEN`, never the value typed in.
 *
 * Verification is two separate claims, kept separate because they are not the
 * same claim:
 *
 *   - what the token says about itself (a local JWT read: scopes, expiry)
 *   - whether the API accepts it (a real request, which CORS may hide)
 */

import { AwElement, define } from '../lib/element.js';
import { el, replace, preserveFocus } from '../lib/dom.js';
import { wireDialog } from '../lib/dialog.js';
import { announce } from '../lib/announce.js';
import { describeScheme, describeSchemeDetail } from '../lib/openapi.js';
import { normaliseCredential, readJwt, describeExpiry, pickProbeOperation, interpretProbe } from '../lib/auth.js';
import { buildRequest } from '../lib/request.js';

class AwAuthSheet extends AwElement {
  static observes = ['authOpen', 'schema', 'auth'];

  #dialog = null;
  #controller = null;
  #revealed = false;
  #draft = null;

  connectedCallback() {
    super.connectedCallback();
    this.#dialog = el('dialog', { 'aria-labelledby': 'auth-title' });
    this.#controller = wireDialog(this.#dialog, {
      initialFocus: () => this.querySelector('#auth-credential'),
      onClose: () => this.actions.closeAuth(),
    });
    replace(this, [this.#dialog]);
    this.#renderSheet();
  }

  render(state) {
    if (!this.#dialog) return;
    if (state.authOpen && !this.#dialog.open) {
      this.#draft = state.auth.credential;
      this.#revealed = false;
      this.#renderSheet();
      this.#controller.open(this.actions.lastInvoker());
    } else if (!state.authOpen && this.#dialog.open) {
      this.#controller.close();
    } else if (state.authOpen) {
      this.#renderSheet();
    }
  }

  #schemes() {
    const schema = this.state.schema;
    return schema ? Object.values(schema.securitySchemes) : [];
  }

  #activeScheme() {
    const schemes = this.#schemes();
    if (!schemes.length) return null;
    const chosen = schemes.find((scheme) => scheme.id === this.state.auth.schemeId);
    return chosen ?? schemes[0];
  }

  /** Rebuild the sheet, putting the keyboard back where it was. */
  #renderSheet() {
    preserveFocus(this.#dialog, () => this.#buildSheet());
  }

  #buildSheet() {
    const state = this.state;
    const schema = state.schema;
    const schemes = this.#schemes();
    const scheme = this.#activeScheme();

    if (!schema) {
      replace(this.#dialog, [
        el('div', { class: 'sheet' }, [
          el('h2', { id: 'auth-title', text: 'Authorise requests' }),
          el('p', { class: 'sheet__lede', text: 'Load a schema first — the credential this asks for is the one the schema declares.' }),
          el('div', { class: 'sheet__actions' }, [this.#closeButton('Close')]),
        ]),
      ]);
      return;
    }

    if (!schemes.length) {
      replace(this.#dialog, [
        el('div', { class: 'sheet' }, [
          el('div', { class: 'sheet__head' }, [
            el('h2', { id: 'auth-title', text: 'Authorise requests' }),
            el('span', { class: 'sheet__esc', text: 'esc' }),
          ]),
          el('p', { class: 'sheet__lede' }, [
            el('span', { text: `${schema.sourceName} declares no security schemes, so there is no credential to set. Requests are sent unauthenticated.` }),
          ]),
          el('div', { class: 'sheet__actions' }, [this.#closeButton('Close')]),
        ]),
      ]);
      return;
    }

    const credentialLabel = labelForScheme(scheme);

    replace(this.#dialog, [
      el('div', { class: 'sheet' }, [
        el('div', { class: 'sheet__head' }, [
          el('h2', { id: 'auth-title', text: 'Authorise requests' }),
          el('span', { class: 'sheet__esc', 'aria-hidden': 'true', text: 'esc' }),
        ]),
        el('p', {
          class: 'sheet__lede',
          text: state.auth.remember
            ? 'This credential is kept on this device until you forget it. It is never written to the schema or to the clipboard snippet, and never sent anywhere but the API itself.'
            : 'This credential stays in this browser tab and is gone when you close it. It is never written to the schema or to the clipboard snippet, and never sent anywhere but the API itself.',
        }),

        /* Provenance: what was found, and where. Only ever what the document
           declares — this is not a place to offer auth the API does not have. */
        el('div', { class: 'inset' }, [
          el('p', { class: 'label label--sm', text: `Declared in ${schema.sourceName}` }),
          schemes.length === 1
            ? el('p', { class: 'inset__value' }, [
                el('span', { text: describeScheme(scheme) }),
                el('span', { class: 'quiet', text: ` ${describeSchemeDetail(scheme).replace(/`/g, '')}` }),
              ])
            : this.#schemePicker(schemes, scheme),
        ]),

        el('div', { class: 'auth-field' }, [
          el('label', { for: 'auth-credential', class: 'choice__label', text: credentialLabel }),
          el('div', { class: 'cred' }, [
            el('input', {
              id: 'auth-credential',
              // A password field hides the value from onlookers; the Show
              // toggle swaps the type rather than faking dots, so the browser
              // and any password manager stay in the loop.
              type: this.#revealed ? 'text' : 'password',
              autocomplete: 'off',
              autocapitalize: 'off',
              spellcheck: 'false',
              'aria-describedby': 'auth-help',
              '.value': this.#draft ?? '',
              oninput: (event) => { this.#draft = event.target.value; },
              onkeydown: (event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  this.#save();
                }
              },
            }),
            el('button', {
              type: 'button',
              class: 'cred__toggle',
              dataset: { focusKey: 'auth-show' },
              'aria-pressed': String(this.#revealed),
              text: this.#revealed ? 'Hide' : 'Show',
              onclick: () => {
                this.#revealed = !this.#revealed;
                const input = this.querySelector('#auth-credential');
                if (input) this.#draft = input.value;
                this.#renderSheet();
                announce(this.#revealed ? 'Credential shown.' : 'Credential hidden.');
              },
            }),
          ]),
          el('p', { class: 'help', id: 'auth-help' }, [
            el('span', { text: 'Paste a token or an ' }),
            el('code', { text: 'Authorization' }),
            el('span', { text: ' header — the prefix is stripped for you. It is held in this tab only, and never written to storage.' }),
          ]),
        ]),

        /* Where the credential lives is the reader's call, and the label says
           what each choice means rather than leaving it to be inferred. */
        el('label', { class: 'choice auth-remember' }, [
          el('input', {
            type: 'checkbox',
            dataset: { focusKey: 'auth-remember' },
            '.checked': Boolean(state.auth.remember),
            onchange: (event) => {
              const input = this.querySelector('#auth-credential');
              if (input) this.#draft = input.value;
              this.actions.setAuth({ remember: event.target.checked });
              announce(event.target.checked
                ? 'Credential will be kept on this device.'
                : 'Credential will be kept for this tab only.');
            },
          }),
          el('span', { class: 'choice__text' }, [
            el('span', { class: 'choice__label', text: 'Remember on this device' }),
            el('span', {
              class: 'choice__hint',
              text: 'Off: held for this tab only and dropped when it closes. On: kept in this browser\u2019s storage, so it is still here tomorrow — and readable by anything else that can read this browser\u2019s data.',
            }),
          ]),
        ]),

        this.#renderVerdict(state),

        el('div', { class: 'sheet__actions' }, [
          el('button', {
            type: 'button',
            class: 'btn btn--filled btn--lg',
            dataset: { focusKey: 'auth-save' },
            text: 'Save for this session',
            onclick: () => this.#save(),
          }),
          el('button', {
            type: 'button',
            class: 'btn btn--lg',
            dataset: { focusKey: 'auth-test' },
            text: state.auth.verifyState === 'checking' ? 'Testing…' : 'Test',
            'aria-disabled': state.auth.verifyState === 'checking' ? 'true' : null,
            onclick: () => this.#test(),
          }),
          state.auth.credential
            ? el('button', {
                type: 'button',
                class: 'btn btn--lg',
                dataset: { focusKey: 'auth-forget' },
                text: 'Forget',
                onclick: () => {
                  this.#draft = '';
                  this.actions.forgetAuth();
                  this.#renderSheet();
                },
              })
            : null,
          this.#closeButton('Close'),
        ]),
      ]),
    ]);
  }

  #schemePicker(schemes, active) {
    return el('div', { role: 'radiogroup', 'aria-label': 'Security scheme' }, schemes.map((scheme) =>
      el('label', { class: 'choice' }, [
        el('input', {
          type: 'radio',
          name: 'auth-scheme',
          value: scheme.id,
          dataset: { focusKey: `auth-scheme-${scheme.id}` },
          '.checked': scheme.id === active.id,
          onchange: () => {
            this.actions.setAuth({ schemeId: scheme.id, verifyState: 'idle', message: '' });
            this.#renderSheet();
          },
        }),
        el('span', { class: 'choice__text' }, [
          el('span', { class: 'choice__label', text: scheme.id }),
          el('span', { class: 'choice__hint', text: `${describeScheme(scheme)} ${describeSchemeDetail(scheme).replace(/`/g, '')}`.trim() }),
        ]),
      ]),
    ));
  }

  /**
   * The verify block. It is inside a live region so a change is announced
   * politely when it happens, and its word ("VERIFIED", "REJECTED") carries
   * the meaning so the tint is never doing the work alone.
   */
  /**
   * Two claims, never conflated: what the token says about itself (read here,
   * locally) and whether the API accepts it (only a real request can say). The
   * leading word carries which one this is, so the tint is never the message.
   */
  #renderVerdict(state) {
    const { verifyState, message, scopes, expiresAt } = state.auth;
    const claims = [
      scopes.length ? `${scopes.length} ${scopes.length === 1 ? 'scope' : 'scopes'}` : null,
      describeExpiry(expiresAt),
    ].filter(Boolean);

    const wrap = (modifier, word, text) =>
      el('div', { class: `verdict verdict--${modifier}`, role: 'status' }, [
        el('span', { class: 'verdict__word', text: word }),
        el('span', { text }),
      ]);

    if (verifyState === 'checking') return wrap('checking', 'CHECKING', message || 'Sending a probe request…');
    if (verifyState === 'valid') return wrap('valid', 'VERIFIED', [message, ...claims].filter(Boolean).join(' · '));
    if (verifyState === 'invalid') return wrap('invalid', 'REJECTED', message);
    if (claims.length) {
      return wrap(
        'unknown',
        'TOKEN SAYS',
        `${claims.join(' · ')}. Read from the token itself — press Test to find out whether the API accepts it.`,
      );
    }
    if (message) return wrap('unknown', 'UNKNOWN', message);
    return wrap('checking', 'NOT TESTED', 'Save a credential and press Test to try it against the API.');
  }

  #closeButton(label) {
    return el('button', {
      type: 'button',
      class: 'btn btn--lg',
      dataset: { focusKey: 'auth-close' },
      text: label,
      onclick: () => this.#controller.close(),
    });
  }

  #save() {
    const input = this.querySelector('#auth-credential');
    const raw = input ? input.value : (this.#draft ?? '');
    const credential = normaliseCredential(raw);
    const scheme = this.#activeScheme();
    const jwt = readJwt(credential);

    this.actions.setAuth({
      schemeId: scheme?.id ?? null,
      credential,
      remember: Boolean(this.state.auth.remember),
      scopes: jwt?.scopes ?? [],
      expiresAt: jwt?.expiresAt ?? null,
      verifyState: 'idle',
      message: jwt && jwt.issuer ? `Issued by ${jwt.issuer}` : '',
    });
    this.#draft = credential;
    this.#renderSheet();
    announce(
      credential
        ? `Credential saved ${this.state.auth.remember ? 'on this device' : 'for this tab'}${jwt ? `. The token declares ${jwt.scopes.length} ${jwt.scopes.length === 1 ? 'scope' : 'scopes'}${describeExpiry(jwt.expiresAt) ? ` and ${describeExpiry(jwt.expiresAt)}` : ''}.` : '.'}`
        : 'Credential cleared.',
    );
  }

  /**
   * A real request against a real endpoint. There is no proxy, so this can be
   * blocked by CORS — in which case it says that, rather than reporting a
   * failure the token had nothing to do with.
   */
  async #test() {
    const state = this.state;
    const scheme = this.#activeScheme();
    if (!scheme) return;
    this.#save();

    const credential = this.state.auth.credential;
    if (!credential) {
      this.actions.setAuth({ verifyState: 'invalid', message: 'There is no credential to test yet.' });
      this.#renderSheet();
      return;
    }

    const probe = pickProbeOperation(state.schema.operations, scheme.id);
    if (!probe) {
      this.actions.setAuth({
        verifyState: 'idle',
        message: 'No GET operation in this schema can be called without inventing a path parameter, so there is nothing safe to probe with. The local read above still stands.',
      });
      this.#renderSheet();
      return;
    }

    const built = buildRequest({
      model: state.schema,
      operation: probe,
      serverUrl: state.baseUrl,
      auth: this.state.auth,
      revealCredential: true,
    });
    if (!built.url || built.url.startsWith('/')) {
      this.actions.setAuth({
        verifyState: 'idle',
        message: 'There is no host in front of these paths, so there is nowhere to send a probe. Set a base URL on the parse report or in Try it, and this can run.',
      });
      this.#renderSheet();
      return;
    }

    this.actions.setAuth({ verifyState: 'checking', message: `Sending GET ${probe.path}…` });
    this.#renderSheet();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(built.url, {
        method: 'GET',
        headers: Object.fromEntries(built.headers),
        mode: 'cors',
        credentials: 'omit',
        signal: controller.signal,
      });
      const verdict = interpretProbe(response.status);
      const jwt = readJwt(credential);
      const detail = `${verdict.text} Probed with GET ${probe.path}.`;
      this.actions.setAuth({
        verifyState: verdict.state,
        message: detail,
        scopes: jwt?.scopes ?? this.state.auth.scopes,
        expiresAt: jwt?.expiresAt ?? this.state.auth.expiresAt,
      });
      announce(`${verdict.word}. ${detail}`);
    } catch (error) {
      const aborted = error?.name === 'AbortError';
      this.actions.setAuth({
        verifyState: 'idle',
        message: aborted
          ? 'The probe timed out after 15 seconds, which says nothing about the token.'
          : 'The browser could not read the probe response — either the host is unreachable, or it did not send CORS headers allowing this origin. Neither tells you whether the token is good. The local read above still stands.',
      });
      announce(`The probe did not produce an answer. ${this.state.auth.message}`, { assertive: true });
    } finally {
      clearTimeout(timer);
      this.#renderSheet();
    }
  }
}

function labelForScheme(scheme) {
  if (!scheme) return 'Credential';
  if (scheme.type === 'http' && scheme.scheme === 'bearer') return 'Bearer token';
  if (scheme.type === 'http' && scheme.scheme === 'basic') return 'Base64 user:password';
  if (scheme.type === 'apiKey') return `API key (${scheme.name ?? 'value'})`;
  if (scheme.type === 'oauth2' || scheme.type === 'openIdConnect') return 'Access token';
  return 'Credential';
}

define('aw-auth-sheet', AwAuthSheet);
