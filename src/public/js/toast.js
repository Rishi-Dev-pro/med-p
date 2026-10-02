/**
 * Toast Notification Utility — Health Tracker
 * Provides client-side lightweight, accessible toast notifications
 * following Health Tracker dark/burnt-orange design aesthetic.
 */

(function () {
    let toastContainer = null;

    function getOrCreateContainer() {
        if (toastContainer && document.body.contains(toastContainer)) {
            return toastContainer;
        }

        toastContainer = document.getElementById('health-tracker-toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'health-tracker-toast-container';
            toastContainer.setAttribute('aria-live', 'polite');
            toastContainer.setAttribute('aria-atomic', 'true');
            toastContainer.style.cssText = `
                position: fixed;
                bottom: 24px;
                right: 24px;
                z-index: 10000;
                display: flex;
                flex-direction: column-reverse;
                gap: 10px;
                pointer-events: none;
                max-width: 400px;
                width: calc(100% - 48px);
            `;
            document.body.appendChild(toastContainer);
        }
        return toastContainer;
    }

    /**
     * Show a toast notification
     * @param {string} message - Message to display
     * @param {string} type - 'info' | 'success' | 'warning' | 'error'
     * @param {number} duration - Milliseconds before auto-dismiss (default 4000)
     */
    function showToast(message, type = 'info', duration = 4000) {
        if (typeof document === 'undefined') return;

        const container = getOrCreateContainer();
        const toast = document.createElement('div');
        toast.className = `health-toast health-toast-${type}`;

        // Color definitions matching the Health Tracker design system
        const styles = {
            info: { border: '#3b82f6', bg: 'rgba(30, 41, 59, 0.96)', text: '#93c5fd', icon: 'ℹ' },
            success: { border: '#22c55e', bg: 'rgba(20, 40, 30, 0.96)', text: '#86efac', icon: '✓' },
            warning: { border: '#eab308', bg: 'rgba(45, 35, 15, 0.96)', text: '#fde047', icon: '⚠' },
            error: { border: '#cc5500', bg: 'rgba(40, 20, 20, 0.96)', text: '#ff9966', icon: '✕' }
        };

        const config = styles[type] || styles.info;

        toast.style.cssText = `
            pointer-events: auto;
            background: ${config.bg};
            border-left: 4px solid ${config.border};
            color: #f1f5f9;
            padding: 12px 16px;
            border-radius: 6px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 13.5px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            opacity: 0;
            transform: translateY(12px) scale(0.98);
        `;

        const content = document.createElement('div');
        content.style.cssText = 'display: flex; align-items: center; gap: 10px; line-height: 1.4;';

        const icon = document.createElement('span');
        icon.style.cssText = `color: ${config.text}; font-weight: bold; font-size: 15px; flex-shrink: 0;`;
        icon.textContent = config.icon;

        const textSpan = document.createElement('span');
        textSpan.textContent = message;

        content.appendChild(icon);
        content.appendChild(textSpan);

        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '&times;';
        closeBtn.setAttribute('aria-label', 'Close toast');
        closeBtn.style.cssText = `
            background: none;
            border: none;
            color: #94a3b8;
            font-size: 18px;
            line-height: 1;
            cursor: pointer;
            padding: 0 4px;
            transition: color 0.15s;
        `;
        closeBtn.onmouseover = () => { closeBtn.style.color = '#f1f5f9'; };
        closeBtn.onmouseout = () => { closeBtn.style.color = '#94a3b8'; };

        function dismiss() {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(8px) scale(0.96)';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 250);
        }

        closeBtn.onclick = dismiss;

        toast.appendChild(content);
        toast.appendChild(closeBtn);
        container.appendChild(toast);

        // Trigger entrance animation
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0) scale(1)';
        });

        if (duration > 0) {
            setTimeout(dismiss, duration);
        }

        return { dismiss };
    }

    if (typeof window !== 'undefined') {
        window.showToast = showToast;
        window.HealthTrackerToast = { show: showToast };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { showToast };
    }
})();
