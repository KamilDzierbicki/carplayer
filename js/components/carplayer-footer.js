class CarplayerFooter extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <a href="https://oxylesson.com/?utm_source=carplayer&utm_medium=web_app&utm_campaign=floating_footer" class="floating-footer-link" target="_blank" rel="noopener noreferrer">
        Ready to learn better? Try OxyLesson!
      </a>
    `;
  }
}

customElements.define("carplayer-footer", CarplayerFooter);
