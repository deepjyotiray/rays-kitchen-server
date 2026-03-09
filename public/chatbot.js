// Chatbot Widget
class RestaurantChatbot {
  constructor() {
    this.isOpen = false;
    this.messages = [];
    this.sessionId = this.generateSessionId();
    this.cart = {}; // { itemName: { price: number, qty: number } }
    this.waitingForMoreItems = false;
    this.init();
  }

  generateSessionId() {
    return 'web-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  init() {
    this.injectHTML();
    this.attachEventListeners();
    this.addBotMessage("Hi! Ask me about our menu - try 'spicy dishes', 'paneer items', or 'rice dishes' 🍽️");
  }

  injectHTML() {
    const html = `
      <div class="chatbot-widget">
        <button class="chatbot-toggle" onclick="chatbot.toggle()"><img src="/favicon.ico" alt="chat"></button>
        <div class="chatbot-window" id="chatbot-window">
          <div class="chatbot-header">
            <h3>Ray's Kitchen Assistant</h3>
            <button class="chatbot-close" onclick="chatbot.toggle()">×</button>
          </div>
          <div class="chatbot-messages" id="chatbot-messages"></div>
          <div class="chatbot-input-area">
            <input 
              type="text" 
              class="chatbot-input" 
              id="chatbot-input" 
              placeholder="Ask about menu, prices..."
              autocomplete="off"
            />
            <button class="chatbot-send" id="chatbot-send" onclick="chatbot.send()">
              ➤
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
  }

  attachEventListeners() {
    const input = document.getElementById('chatbot-input');
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.send();
    });

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => this._onViewportResize());
      window.visualViewport.addEventListener('scroll', () => this._onViewportResize());
    }
  }

  _onViewportResize() {
    if (!this.isOpen || window.innerWidth > 768) return;
    const win = document.getElementById('chatbot-window');
    if (!win) return;
    const vv = window.visualViewport;
    win.style.height = vv.height + 'px';
    win.style.top = vv.offsetTop + 'px';
    const msgs = document.getElementById('chatbot-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }

  toggle() {
    this.isOpen = !this.isOpen;
    const win = document.getElementById('chatbot-window');
    win.classList.toggle('open', this.isOpen);
    if (this.isOpen) {
      document.getElementById('chatbot-input').focus();
      document.body.style.overflow = 'hidden';
    } else {
      win.style.bottom = '';
      win.style.top = '';
      win.style.height = '';
      document.body.style.overflow = '';
    }
  }

  addMessage(text, isBot = false) {
    const messagesDiv = document.getElementById('chatbot-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `chatbot-message ${isBot ? 'bot' : 'user'}`;
    messageDiv.textContent = text;
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  addMenuItems(items) {
    const messagesDiv = document.getElementById('chatbot-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chatbot-message bot';
    
    const intro = document.createElement('div');
    intro.textContent = 'We have:';
    intro.style.marginBottom = '8px';
    messageDiv.appendChild(intro);

    items.forEach(item => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'chatbot-menu-item';
      
      const info = document.createElement('div');
      info.className = 'chatbot-item-info';
      
      const name = document.createElement('div');
      name.className = 'chatbot-item-name';
      name.textContent = item.name;
      
      const price = document.createElement('div');
      price.className = 'chatbot-item-price';
      price.textContent = `₹${item.price}`;
      
      info.appendChild(name);
      info.appendChild(price);
      
      const controls = document.createElement('div');
      controls.className = 'chatbot-quantity-control';
      
      const minusBtn = document.createElement('button');
      minusBtn.className = 'chatbot-qty-btn';
      minusBtn.textContent = '-';
      minusBtn.onclick = () => this.updateCart(item.name, item.price, -1);
      
      const qtyDisplay = document.createElement('span');
      qtyDisplay.className = 'chatbot-qty-display';
      qtyDisplay.id = `qty-${item.name.replace(/\s/g, '-')}`;
      qtyDisplay.textContent = this.cart[item.name]?.qty || 0;
      
      const plusBtn = document.createElement('button');
      plusBtn.className = 'chatbot-qty-btn';
      plusBtn.textContent = '+';
      plusBtn.onclick = () => this.updateCart(item.name, item.price, 1);
      
      controls.appendChild(minusBtn);
      controls.appendChild(qtyDisplay);
      controls.appendChild(plusBtn);
      
      itemDiv.appendChild(info);
      itemDiv.appendChild(controls);
      messageDiv.appendChild(itemDiv);
    });
    
    messagesDiv.appendChild(messageDiv);
    this.updateCartSummary();
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  updateCart(itemName, price, delta) {
    if (!this.cart[itemName]) {
      this.cart[itemName] = { price, qty: 0 };
    }
    this.cart[itemName].qty += delta;
    if (this.cart[itemName].qty <= 0) {
      delete this.cart[itemName];
    }
    
    const qtyDisplay = document.getElementById(`qty-${itemName.replace(/\s/g, '-')}`);
    if (qtyDisplay) {
      qtyDisplay.textContent = this.cart[itemName]?.qty || 0;
    }
    
    this.updateCartSummary();
    
    if (Object.keys(this.cart).length > 0 && delta > 0) {
      this.waitingForMoreItems = true;
      setTimeout(() => this.addBotMessage("Anything else? (yes/no)"), 500);
    }
  }

  updateCartSummary() {
    let existing = document.getElementById('chatbot-cart-summary');
    if (existing) existing.remove();
    
    const items = Object.keys(this.cart);
    if (items.length === 0) return;
    
    const messagesDiv = document.getElementById('chatbot-messages');
    const summaryDiv = document.createElement('div');
    summaryDiv.id = 'chatbot-cart-summary';
    summaryDiv.className = 'chatbot-message bot chatbot-cart-summary';
    
    const title = document.createElement('div');
    title.textContent = 'Your Cart:';
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '8px';
    summaryDiv.appendChild(title);
    
    let total = 0;
    items.forEach(name => {
      const { price, qty } = this.cart[name];
      const itemDiv = document.createElement('div');
      itemDiv.className = 'chatbot-cart-item';
      itemDiv.innerHTML = `<span>${name} x${qty}</span><span>₹${price * qty}</span>`;
      summaryDiv.appendChild(itemDiv);
      total += price * qty;
    });
    
    const totalDiv = document.createElement('div');
    totalDiv.className = 'chatbot-cart-total';
    totalDiv.innerHTML = `<span>Total</span><span>₹${total}</span>`;
    totalDiv.style.display = 'flex';
    totalDiv.style.justifyContent = 'space-between';
    summaryDiv.appendChild(totalDiv);
    
    const checkoutBtn = document.createElement('button');
    checkoutBtn.textContent = 'Show Cart';
    checkoutBtn.style.cssText = 'width:100%;margin-top:10px;padding:10px;background:#ff6b35;color:white;border:none;border-radius:5px;cursor:pointer;font-weight:bold';
    checkoutBtn.onclick = () => this.proceedToCheckout();
    summaryDiv.appendChild(checkoutBtn);
    
    messagesDiv.appendChild(summaryDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  proceedToCheckout() {
    Object.keys(this.cart).forEach(name => {
      const { price, qty } = this.cart[name];
      const id = name.replace(/\s+/g, '_').toLowerCase();
      window.updateQty?.(id, name, price, qty);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    this.toggle();
    this.addBotMessage("Items added to cart! 🛒");
  }

  addBotMessage(text) {
    this.addMessage(text, true);
  }

  showTyping() {
    const messagesDiv = document.getElementById('chatbot-messages');
    const typingDiv = document.createElement('div');
    typingDiv.className = 'chatbot-message bot chatbot-typing';
    typingDiv.id = 'typing-indicator';
    typingDiv.innerHTML = '<span></span><span></span><span></span>';
    messagesDiv.appendChild(typingDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  hideTyping() {
    const typing = document.getElementById('typing-indicator');
    if (typing) typing.remove();
  }

  async send() {
    const input = document.getElementById('chatbot-input');
    const message = input.value.trim();
    if (!message) return;

    // Check if authenticated
    try {
      const sessionRes = await fetch('/api/auth/session');
      const sessionData = await sessionRes.json();
      
      if (!sessionData.authenticated) {
        this._pendingMessage = message;
        this.addBotMessage('Please verify your mobile number first.');
        setTimeout(() => {
          if (typeof showOTPModalForChat === 'function') {
            showOTPModalForChat();
          }
        }, 500);
        return;
      }
    } catch (err) {
      this._pendingMessage = message;
      this.addBotMessage('Please verify your mobile number first.');
      return;
    }

    this.addMessage(message, false);
    input.value = '';
    
    const sendBtn = document.getElementById('chatbot-send');
    sendBtn.disabled = true;
    this.showTyping();

    // Check if waiting for yes/no response
    if (this.waitingForMoreItems) {
      this.hideTyping();
      const msg = message.toLowerCase();
      
      if (msg.match(/^(no|nope|nah|done|that's all|thats all)$/)) {
        this.waitingForMoreItems = false;
        this.proceedToCheckout();
        sendBtn.disabled = false;
        return;
      } else if (msg.match(/^(yes|yeah|yep|yup|sure)$/)) {
        this.waitingForMoreItems = false;
        this.addBotMessage("What else would you like?");
        sendBtn.disabled = false;
        input.focus();
        return;
      }
      // If not yes/no, treat as new item request
      this.waitingForMoreItems = false;
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: message,
          sessionId: this.sessionId
        })
      });

      if (!response.ok) throw new Error('Network error');
      
      const data = await response.json();
      this.hideTyping();
      
      if (data.items && data.items.length > 0) {
        this.addMenuItems(data.items);
      } else {
        this.addBotMessage(data.response || "Sorry, I couldn't process that. Please try again.");
      }
    } catch (error) {
      this.hideTyping();
      this.addBotMessage("Sorry, I'm having trouble connecting. Please try WhatsApp or call us.");
      console.error('Chatbot error:', error);
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }
}

// Initialize chatbot when page loads
let chatbot;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    chatbot = new RestaurantChatbot();
  });
} else {
  chatbot = new RestaurantChatbot();
}

window.showOTPModalForChat = function () {
  if (typeof showOTPModal === 'function') showOTPModal();
};

window._chatbotSendPending = function () {
  if (chatbot && chatbot._pendingMessage) {
    const msg = chatbot._pendingMessage;
    chatbot._pendingMessage = null;
    document.getElementById('chatbot-input').value = msg;
    chatbot.send();
  }
};
