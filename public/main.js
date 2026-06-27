// ============================================================================
// TOAST NOTIFICATIONS
// ============================================================================

// Show a toast notification
function showToast(message, type = 'success', duration = 4000) {
  const container = document.getElementById('toast-container') || createToastContainer();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    ${message}
    <span class="close-btn" onclick="this.parentElement.removeToast()">✕</span>
  `;

  container.appendChild(toast);

  // Add method to toast for removal
  toast.removeToast = function() {
    this.classList.add('fade-out');
    setTimeout(() => this.remove(), 300);
  };

  // Auto-dismiss after duration
  setTimeout(() => {
    if (toast.parentElement) {
      toast.removeToast();
    }
  }, duration);
}

function createToastContainer() {
  const container = document.createElement('div');
  container.id = 'toast-container';
  container.className = 'toast-container';
  document.body.appendChild(container);
  return container;
}

// ============================================================================
// BUTTON LOADING STATE
// ============================================================================

// Add loading state to form submit buttons
document.addEventListener('DOMContentLoaded', function() {
  const forms = document.querySelectorAll('form');

  forms.forEach(form => {
    form.addEventListener('submit', function(e) {
      const submitBtn = this.querySelector('button[type="submit"]');

      if (submitBtn) {
        // Store original text
        const originalText = submitBtn.textContent;
        const originalHTML = submitBtn.innerHTML;

        // Determine loading text based on button context
        let loadingText = 'Saving...';
        if (originalText.includes('Book') || originalText.includes('book')) {
          loadingText = 'Booking...';
        } else if (originalText.includes('Login') || originalText.includes('login')) {
          loadingText = 'Logging in...';
        } else if (originalText.includes('Publish')) {
          loadingText = 'Publishing...';
        } else if (originalText.includes('Join')) {
          loadingText = 'Joining...';
        }

        // Disable button and show loading state
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.7';
        submitBtn.style.pointerEvents = 'none';
        submitBtn.textContent = loadingText;

        // Note: button state is reset when page redirects/reloads
        // This provides brief visual feedback before navigation
      }
    });
  });

  // Close toast notifications on click
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('close-btn')) {
      e.target.parentElement.removeToast?.();
    }
  });
});
