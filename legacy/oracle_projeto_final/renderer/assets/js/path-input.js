/**
 * PathInput — Componente de campo para caminhos de pasta/arquivo
 * Resolve o problema de editar caminhos longos em telas menores
 */

class PathInput {
  /**
   * @param {HTMLElement} wrapper - elemento .path-field
   * @param {HTMLInputElement} input - o input[type=text] dentro do wrapper
   */
  constructor(wrapper, input) {
    this.wrapper = wrapper;
    this.input = input;
    this._buildActions();
    this._bindEvents();
  }

  _buildActions() {
    // Separador visual
    const sep = document.createElement('div');
    sep.className = 'path-field-sep';

    // Container de botões
    const actions = document.createElement('div');
    actions.className = 'path-field-actions';

    // Botão copiar
    this.copyBtn = document.createElement('button');
    this.copyBtn.className = 'path-btn path-copy-btn';
    this.copyBtn.type = 'button';
    this.copyBtn.title = 'Copiar caminho';
    this.copyBtn.innerHTML = '⎘';

    // Botão editar (abre modal)
    this.editBtn = document.createElement('button');
    this.editBtn.className = 'path-btn path-edit-btn';
    this.editBtn.type = 'button';
    this.editBtn.title = 'Editar caminho em tela cheia';
    this.editBtn.innerHTML = '✎ editar';

    actions.appendChild(this.copyBtn);
    actions.appendChild(this.editBtn);

    this.wrapper.appendChild(sep);
    this.wrapper.appendChild(actions);
  }

  _bindEvents() {
    this.copyBtn.addEventListener('click', () => this._copyPath());
    this.editBtn.addEventListener('click', () => this._openModal());
  }

  _copyPath() {
    const val = this.input.value;
    if (!val) return;
    navigator.clipboard.writeText(val).then(() => {
      this.copyBtn.classList.add('copied');
      this.copyBtn.innerHTML = '✓';
      setTimeout(() => {
        this.copyBtn.classList.remove('copied');
        this.copyBtn.innerHTML = '⎘';
      }, 1500);
    });
  }

  _parseSegments(path) {
    // Detecta separador (Windows vs Unix)
    const sep = path.includes('\\') ? '\\' : '/';
    const parts = path.split(sep).filter(Boolean);
    return { parts, sep };
  }

  _openModal() {
    const overlay = document.createElement('div');
    overlay.className = 'path-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'path-modal';

    const label = this.wrapper.closest('.field')?.querySelector('label')?.textContent || 'Caminho';

    // Título
    const title = document.createElement('div');
    title.className = 'path-modal-title';
    title.innerHTML = `
      <div class="path-modal-title-icon">📁</div>
      Editar — ${label}
    `;

    // Segmentos clicáveis
    const segLabel = document.createElement('div');
    segLabel.className = 'path-modal-sublabel';
    segLabel.textContent = 'Clique em um segmento para navegar até ele';

    const segContainer = document.createElement('div');
    segContainer.className = 'path-segments';

    // Textarea grande
    const taLabel = document.createElement('div');
    taLabel.className = 'path-modal-sublabel';
    taLabel.style.marginTop = '14px';
    taLabel.textContent = 'Caminho completo';

    const ta = document.createElement('textarea');
    ta.value = this.input.value;
    ta.spellcheck = false;
    ta.autocomplete = 'off';

    // Dica
    const hint = document.createElement('div');
    hint.className = 'path-hint';
    hint.textContent = '💡 Dica: Cole o caminho copiado do Explorer ou edite diretamente no campo acima.';

    // Footer
    const footer = document.createElement('div');
    footer.className = 'path-modal-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'path-modal-cancel';
    cancelBtn.textContent = 'Cancelar';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'path-modal-confirm';
    confirmBtn.textContent = 'Confirmar';

    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);

    modal.appendChild(title);
    modal.appendChild(segLabel);
    modal.appendChild(segContainer);
    modal.appendChild(taLabel);
    modal.appendChild(ta);
    modal.appendChild(hint);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Foca no final do textarea
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    const renderSegments = (path) => {
      segContainer.innerHTML = '';
      if (!path) return;
      const { parts, sep } = this._parseSegments(path);
      let accumulated = '';
      parts.forEach((part, i) => {
        const isFirst = i === 0;
        if (!isFirst) {
          const s = document.createElement('span');
          s.className = 'path-sep';
          s.textContent = sep;
          segContainer.appendChild(s);
          accumulated += sep;
        }
        accumulated += part;
        const seg = document.createElement('span');
        seg.className = 'path-segment';
        seg.textContent = part;
        const capPath = accumulated;
        seg.addEventListener('click', () => {
          ta.value = capPath;
          renderSegments(capPath);
        });
        segContainer.appendChild(seg);
      });
    };

    renderSegments(ta.value);

    ta.addEventListener('input', () => renderSegments(ta.value));

    const close = (apply) => {
      if (apply) {
        this.input.value = ta.value.trim();
        this.input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      overlay.remove();
    };

    confirmBtn.addEventListener('click', () => close(true));
    cancelBtn.addEventListener('click', () => close(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { close(false); document.removeEventListener('keydown', esc); }
    });
  }
}

/**
 * Inicializa todos os campos .path-field na página
 */
export function initPathInputs() {
  document.querySelectorAll('.path-field').forEach(wrapper => {
    const input = wrapper.querySelector('input[type="text"]');
    if (input && !wrapper._pathInput) {
      wrapper._pathInput = new PathInput(wrapper, input);
    }
  });
}
