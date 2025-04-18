/**
 * Next Identity Authentication Widget
 * Handles Next Identity authentication flow with PKCE
 */
class NIWidget {
  constructor(config) {
    this.config = config;
    this.state = {};
    this.debug = config.debug || false;
    this.discoveredConfig = null;
    this.log('Widget initialized with config:', config);
    this.initialize();
  }

  /**
   * Debug logger function
   */
  log(...args) {
    if (this.debug) {
      console.log('[NI Widget]', ...args);
    }
  }
  
  /**
   * Initialize the widget
   */
  async initialize() {
    try {
      // First fetch OIDC configuration from discovery endpoint
      await this.fetchOIDCConfig();
      
      // Check if we need to create the widget structure
      this.ensureWidgetStructure();
      
      // Then initialize state and event listeners
      this.initializeState();
      this.setupEventListeners();
    } catch (error) {
      console.error('Widget initialization failed:', error);
      this.log('Widget initialization failed:', error.message);
      
      // Dispatch error event
      const event = new CustomEvent('ni:error', {
        detail: { 
          error: 'initialization_failed',
          errorDescription: error.message
        }
      });
      document.dispatchEvent(event);
      
      // Show error in UI if element exists
      const errorElement = document.querySelector('.ni-error');
      if (errorElement) {
        errorElement.textContent = `Initialization failed: ${error.message}`;
        errorElement.classList.add('active');
      }
    }
  }
  
  /**
   * Fetch OIDC configuration from discovery endpoint
   */
  async fetchOIDCConfig() {
    if (!this.config.issuerUrl) {
      throw new Error('Issuer URL is required but not provided in configuration');
    }
    
    this.log('Fetching OIDC configuration from discovery endpoint');
    const discoveryUrl = `${this.config.issuerUrl}/.well-known/openid-configuration`;
    this.log('Discovery URL:', discoveryUrl);
    
    try {
      const response = await fetch(discoveryUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch OIDC configuration: ${response.status} ${response.statusText}`);
      }
      
      this.discoveredConfig = await response.json();
      this.log('OIDC configuration fetched successfully:', this.discoveredConfig);
      
      // Validate required endpoints
      if (!this.discoveredConfig.authorization_endpoint) {
        throw new Error('Authorization endpoint not found in OIDC configuration');
      }
      
      if (!this.discoveredConfig.token_endpoint) {
        throw new Error('Token endpoint not found in OIDC configuration');
      }
      
      return this.discoveredConfig;
    } catch (error) {
      console.error('Failed to fetch OIDC configuration:', error);
      throw new Error(`Failed to fetch OIDC configuration: ${error.message}`);
    }
  }

  /**
   * Initialize widget state
   */
  initializeState() {
    // Check if we're in a callback from auth flow
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    
    this.log('Initializing state. Code present:', !!code, 'State present:', !!state);
    
    if (code && state) {
      // Clean up URL immediately to prevent accidental reuse
      this.log('Cleaning up URL by removing query parameters');
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // Immediately show loading state
      this.showAuthProcessingUI('Completing authentication...');
      
      // Handle the callback with the auth code
      this.handleCallback(code, state);
    } else {
      // Check if user is already authenticated
      const tokenData = this.getStoredTokenData();
      if (tokenData && tokenData.idTokenPayload) {
        this.log('User already authenticated, updating UI');
        // Update UI to show welcome message
        this.updateUIAfterAuthentication(tokenData.idTokenPayload);
      } else {
        // Clear any existing tokens if not in callback flow
        this.clearStoredTokenData();
      }
    }
  }

  /**
   * Show authentication processing UI
   */
  showAuthProcessingUI(message = 'Processing authentication...') {
    this.log('Showing auth processing UI');
    
    // Hide auth buttons if they exist
    const authButtons = document.querySelector('.ni-auth-buttons');
    if (authButtons) {
      authButtons.style.display = 'none';
    }
    
    // Show loading indicator
    const loadingElem = document.querySelector('.ni-loading');
    if (loadingElem) {
      loadingElem.classList.add('active');
    }
    
    // Create or update processing message
    let processingMessage = document.querySelector('.ni-processing-message');
    if (!processingMessage) {
      processingMessage = document.createElement('div');
      processingMessage.className = 'ni-processing-message';
      
      // Insert after header if exists, or at the beginning of container
      const widgetContainer = document.querySelector('.ni-widget-container');
      const widgetHeader = document.querySelector('.ni-widget-header');
      
      if (widgetContainer) {
        if (widgetHeader) {
          widgetContainer.insertBefore(processingMessage, widgetHeader.nextSibling);
        } else {
          widgetContainer.insertBefore(processingMessage, widgetContainer.firstChild);
        }
      }
    }
    
    if (processingMessage) {
      processingMessage.textContent = message;
      processingMessage.style.display = 'block';
    }
  }

  /**
   * Set up event listeners for auth buttons
   */
  setupEventListeners() {
    this.log('Setting up event listeners');
    
    // First approach: standard DOMContentLoaded listener
    document.addEventListener('DOMContentLoaded', () => {
      this.attachButtonListeners();
    });
    
    // Second approach: try immediately if DOM is already loaded
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      this.log('DOM already loaded, attaching listeners immediately');
      this.attachButtonListeners();
    }
    
    // Third approach: use event delegation on the document level
    document.addEventListener('click', (e) => {
      const button = e.target.closest('.ni-auth-button');
      if (button) {
        e.preventDefault();
        const providerId = button.getAttribute('data-provider-id');
        this.log('Auth button clicked via delegation for provider:', providerId);
        this.initiateLogin(providerId);
      }
    });
  }
  
  /**
   * Attach listeners to all auth buttons
   */
  attachButtonListeners() {
    // Find all auth buttons in the widget
    const authButtons = document.querySelectorAll('.ni-auth-button');
    
    this.log('Found', authButtons.length, 'auth buttons to attach listeners to');
    
    authButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        e.preventDefault();
        const providerId = button.getAttribute('data-provider-id');
        this.log('Auth button clicked directly for provider:', providerId);
        this.initiateLogin(providerId);
      });
      
      // Mark button as having listener attached
      button.setAttribute('data-listener-attached', 'true');
      this.log('Attached listener to button:', button.getAttribute('data-provider-id'));
    });

    // Apply customizations
    this.applyCustomizations();
  }

  /**
   * Generate a random string for state and code verifier
   */
  generateRandomString(length = 64) {
    this.log('Generating random string of length:', length);
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let result = '';
    const values = new Uint8Array(length);
    crypto.getRandomValues(values);
    for (let i = 0; i < length; i++) {
      result += charset[values[i] % charset.length];
    }
    this.log('Generated random string (first 10 chars):', result.substring(0, 10) + '...');
    return result;
  }

  /**
   * Calculate code challenge from code verifier (for PKCE)
   */
  async calculateCodeChallenge(codeVerifier) {
    this.log('Calculating code challenge from verifier');
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    
    // Convert to base64url
    const result = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    
    this.log('Code challenge calculated (first 10 chars):', result.substring(0, 10) + '...');
    return result;
  }

  /**
   * Store auth state in localStorage
   */
  storeAuthState(state, codeVerifier, providerId) {
    this.log('Storing auth state for provider:', providerId);
    const stateData = {
      state,
      codeVerifier,
      providerId,
      timestamp: Date.now()
    };
    localStorage.setItem('ni_auth_state', JSON.stringify(stateData));
    this.log('Auth state stored successfully');
  }

  /**
   * Get stored auth state from localStorage
   */
  getStoredAuthState() {
    this.log('Retrieving stored auth state');
    const stateData = localStorage.getItem('ni_auth_state');
    if (!stateData) {
      this.log('No stored auth state found');
      return null;
    }
    
    try {
      const parsedState = JSON.parse(stateData);
      this.log('Retrieved auth state for provider:', parsedState.providerId);
      return parsedState;
    } catch (e) {
      console.error('Failed to parse auth state:', e);
      return null;
    }
  }

  /**
   * Clear stored auth state
   */
  clearStoredAuthState() {
    this.log('Clearing stored auth state');
    localStorage.removeItem('ni_auth_state');
  }

  /**
   * Store token data
   */
  storeTokenData(tokenData) {
    this.log('Storing token data for provider:', tokenData.providerId);
    localStorage.setItem('ni_token_data', JSON.stringify(tokenData));
    
    // Dispatch event for token received
    const event = new CustomEvent('ni:tokens_received', {
      detail: tokenData
    });
    this.log('Dispatching tokens_received event');
    document.dispatchEvent(event);
  }

  /**
   * Get stored token data
   */
  getStoredTokenData() {
    this.log('Retrieving stored token data');
    const tokenData = localStorage.getItem('ni_token_data');
    if (!tokenData) {
      this.log('No stored token data found');
      return null;
    }
    
    try {
      const parsedTokens = JSON.parse(tokenData);
      this.log('Retrieved token data for provider:', parsedTokens.providerId);
      return parsedTokens;
    } catch (e) {
      console.error('Failed to parse token data:', e);
      return null;
    }
  }

  /**
   * Clear stored token data
   */
  clearStoredTokenData() {
    this.log('Clearing stored token data');
    localStorage.removeItem('ni_token_data');
  }

  /**
   * Parse and validate ID token
   */
  parseIdToken(idToken) {
    this.log('Parsing ID token');
    try {
      const parts = idToken.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid token format');
      }
      
      const payload = JSON.parse(atob(parts[1]));
      this.log('ID token parsed successfully. Subject:', payload.sub);
      return payload;
    } catch (e) {
      console.error('Failed to parse ID token:', e);
      return null;
    }
  }

  /**
   * Initiate login process for a provider
   */
  async initiateLogin(providerId) {
    try {
      this.log('Initiating login for provider:', providerId);
      
      // Ensure we have discovered OIDC configuration
      if (!this.discoveredConfig) {
        this.log('OIDC configuration not available, fetching now...');
        await this.fetchOIDCConfig();
      }
      
      // Validate providerId
      if (!providerId) {
        throw new Error('Provider ID is required but was not provided');
      }
      
      // Find provider in config
      const provider = this.config.providers.find(p => p.id === providerId);
      if (!provider) {
        throw new Error(`Provider with ID ${providerId} not found in configuration`);
      }
      
      this.log('Found provider configuration:', provider.name);
      
      // Validate client ID
      if (!provider.clientId) {
        throw new Error(`Client ID is missing for provider: ${provider.name}`);
      }
      
      // Generate state and code verifier for PKCE
      const state = this.generateRandomString(32);
      const codeVerifier = this.generateRandomString(64);
      let codeChallenge;
      
      try {
        codeChallenge = await this.calculateCodeChallenge(codeVerifier);
      } catch (error) {
        throw new Error(`Failed to calculate code challenge: ${error.message}`);
      }
      
      // Store state and code verifier
      this.storeAuthState(state, codeVerifier, providerId);
      
      // Build authorization URL using discovered authorization endpoint
      try {
        const authUrl = new URL(this.discoveredConfig.authorization_endpoint);
        authUrl.searchParams.append('client_id', provider.clientId);
        authUrl.searchParams.append('response_type', 'code');
        authUrl.searchParams.append('redirect_uri', this.config.redirectUri);
        authUrl.searchParams.append('scope', this.config.scope);
        authUrl.searchParams.append('state', state);
        authUrl.searchParams.append('code_challenge', codeChallenge);
        authUrl.searchParams.append('code_challenge_method', this.config.pkce.challengeMethod);
        
        this.log('Auth URL created:', authUrl.toString());
        
        // Dispatch event for login initiated
        const event = new CustomEvent('ni:login_initiated', {
          detail: { providerId }
        });
        this.log('Dispatching login_initiated event');
        document.dispatchEvent(event);
        
        // Show loading indicator if present
        const loadingElement = document.querySelector('.ni-loading');
        if (loadingElement) {
          this.log('Showing loading indicator');
          loadingElement.classList.add('active');
        }
        
        // Redirect to authorization endpoint
        this.log('Redirecting to authorization endpoint');
        console.log('REDIRECT URL:', authUrl.toString());
        window.location.href = authUrl.toString();
      } catch (error) {
        throw new Error(`Failed to construct authorization URL: ${error.message}`);
      }
    } catch (e) {
      console.error('Login initiation failed:', e);
      this.log('Login initiation failed with error:', e.message);
      
      // Show error in UI if element exists
      const errorElement = document.querySelector('.ni-error');
      if (errorElement) {
        errorElement.textContent = e.message;
        errorElement.classList.add('active');
        
        // Hide loading
        const loadingElement = document.querySelector('.ni-loading');
        if (loadingElement) {
          loadingElement.classList.remove('active');
        }
      }
      
      // Dispatch error event
      const event = new CustomEvent('ni:error', {
        detail: { 
          error: 'login_failed',
          errorDescription: e.message
        }
      });
      document.dispatchEvent(event);
    }
  }

  /**
   * Handle auth callback
   */
  async handleCallback(code, returnedState) {
    try {
      this.log('Handling auth callback. Code present, state:', returnedState);
      
      // Get stored state data
      const storedStateData = this.getStoredAuthState();
      if (!storedStateData) {
        throw new Error('No stored authentication state found');
      }
      
      // Validate state
      this.log('Validating state parameter');
      if (storedStateData.state !== returnedState) {
        this.log('State mismatch! Expected:', storedStateData.state, 'Received:', returnedState);
        throw new Error('State mismatch - possible CSRF attack');
      }
      
      this.log('State validated successfully');
      
      // Find provider
      const provider = this.config.providers.find(p => p.id === storedStateData.providerId);
      if (!provider) {
        throw new Error(`Provider with ID ${storedStateData.providerId} not found`);
      }
      
      this.log('Found provider configuration:', provider.name);
      
      // Ensure we have OIDC configuration before exchanging the code
      if (!this.discoveredConfig) {
        this.log('OIDC configuration not available, fetching now...');
        await this.fetchOIDCConfig();
      }
      
      // Exchange code for tokens
      this.log('Exchanging code for tokens');
      const tokenResponse = await this.exchangeCodeForTokens(
        code, 
        storedStateData.codeVerifier, 
        provider.clientId
      );
      
      this.log('Token exchange successful');
      
      // Parse ID token
      const idTokenPayload = this.parseIdToken(tokenResponse.id_token);
      
      // Store token data
      this.storeTokenData({
        accessToken: tokenResponse.access_token,
        idToken: tokenResponse.id_token,
        refreshToken: tokenResponse.refresh_token,
        expiresIn: tokenResponse.expires_in,
        tokenType: tokenResponse.token_type,
        scope: tokenResponse.scope,
        idTokenPayload,
        providerId: storedStateData.providerId
      });
      
      // Clear state data as it's no longer needed
      this.clearStoredAuthState();
      
      // Update UI to show welcome message
      this.updateUIAfterAuthentication(idTokenPayload);
      
      // Dispatch authenticated event
      const event = new CustomEvent('ni:authenticated', {
        detail: {
          user: idTokenPayload,
          providerId: storedStateData.providerId
        }
      });
      this.log('Dispatching authenticated event');
      document.dispatchEvent(event);
    } catch (e) {
      console.error('Authentication callback failed:', e);
      this.log('Authentication callback failed with error:', e.message);
      
      // Clear state data
      this.clearStoredAuthState();
      
      // Dispatch error event
      const event = new CustomEvent('ni:error', {
        detail: { 
          error: 'callback_failed',
          errorDescription: e.message
        }
      });
      document.dispatchEvent(event);
    }
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code, codeVerifier, clientId) {
    this.log('Exchanging code for tokens with client ID:', clientId);
    
    // Use discovered token endpoint
    const tokenUrl = this.discoveredConfig.token_endpoint;
    
    // Create payload
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', this.config.redirectUri);
    params.append('client_id', clientId);
    params.append('code_verifier', codeVerifier);
    
    this.log('Token request URL:', tokenUrl);
    this.log('Token request parameters:', {
      grant_type: 'authorization_code',
      code: code.substring(0, 10) + '...',
      redirect_uri: this.config.redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier.substring(0, 10) + '...'
    });
    
    try {
      // Make token request
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
      });
      
      if (!response.ok) {
        const error = await response.json();
        this.log('Token exchange failed. Status:', response.status, 'Error:', error);
        throw new Error(error.error_description || `Failed to exchange code for tokens: ${response.status}`);
      }
      
      const tokenData = await response.json();
      this.log('Token exchange response received successfully');
      return tokenData;
    } catch (error) {
      this.log('Error during token exchange:', error.message);
      throw error;
    }
  }

  /**
   * Logout user
   */
  async logout() {
    this.log('Logging out user');
    const tokenData = this.getStoredTokenData();
    
    // Clear local storage first
    this.clearStoredTokenData();
    
    // Dispatch logout event
    const event = new CustomEvent('ni:logout', {
      detail: tokenData ? { providerId: tokenData.providerId } : {}
    });
    this.log('Dispatching logout event');
    document.dispatchEvent(event);
    
    // Update UI
    const welcomeContainer = document.querySelector('.ni-welcome-container');
    const signInContainer = document.querySelector('.ni-widget-container');
    if (welcomeContainer) {
      welcomeContainer.style.display = 'none';
    }
    if (signInContainer) {
      signInContainer.style.display = 'block';
    }
    
    // Use end_session_endpoint if available in discoveredConfig
    if (this.discoveredConfig && this.discoveredConfig.end_session_endpoint && tokenData) {
      try {
        this.log('End session endpoint found, redirecting for logout');
        
        // Find provider in config
        const provider = this.config.providers.find(p => p.id === tokenData.providerId);
        if (!provider) {
          throw new Error(`Provider with ID ${tokenData.providerId} not found`);
        }
        
        const logoutUrl = new URL(this.discoveredConfig.end_session_endpoint);
        
        // Add client_id parameter
        if (provider.clientId) {
          logoutUrl.searchParams.append('client_id', provider.clientId);
        }
        
        // Add redirect_uri parameter
        logoutUrl.searchParams.append('redirect_uri', this.config.redirectUri);
        
        this.log('Redirecting to end session endpoint:', logoutUrl.toString());
        window.location.href = logoutUrl.toString();
      } catch (error) {
        console.error('Logout redirect failed:', error);
        this.log('Logout redirect failed:', error.message);
      }
    }
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    const isAuth = !!this.getStoredTokenData();
    this.log('Checking authentication status:', isAuth);
    return isAuth;
  }

  /**
   * Get current user information
   */
  getCurrentUser() {
    this.log('Getting current user information');
    const tokenData = this.getStoredTokenData();
    return tokenData ? tokenData.idTokenPayload : null;
  }

  /**
   * Apply customizations from config
   */
  applyCustomizations() {
    this.log('Applying customizations from config');
    const customization = this.config.customization;
    const root = document.documentElement;
    
    // Set CSS variables
    root.style.setProperty('--ni-button-radius', customization.buttonRadius);
    root.style.setProperty('--ni-button-color', customization.buttonColor);
    root.style.setProperty('--ni-button-text-color', customization.buttonTextColor);
    root.style.setProperty('--ni-font-family', customization.fontFamily);
    root.style.setProperty('--ni-widget-width', customization.widgetWidth);
    this.log('Customizations applied successfully');
  }

  /**
   * Update UI after successful authentication
   */
  updateUIAfterAuthentication(userInfo) {
    this.log('Updating UI after authentication');
    
    // Find sign-in container
    const signInContainer = document.querySelector('.ni-widget-container');
    if (!signInContainer) {
      this.log('Sign-in container not found');
      return;
    }
    
    // Get user's first name or fallback to generic welcome
    let welcomeMessage = 'Welcome';
    if (userInfo) {
      const firstName = userInfo.given_name || userInfo.name?.split(' ')[0] || userInfo.preferred_username;
      if (firstName) {
        welcomeMessage = `Welcome, ${firstName}`;
      }
    }
    
    // Check if welcome message container already exists
    let welcomeContainer = document.querySelector('.ni-welcome-container');
    if (!welcomeContainer) {
      // Create welcome container
      welcomeContainer = document.createElement('div');
      welcomeContainer.className = 'ni-welcome-container';
      
      // Add welcome message
      const welcomeText = document.createElement('h2');
      welcomeText.className = 'ni-welcome-text';
      welcomeText.textContent = welcomeMessage;
      welcomeContainer.appendChild(welcomeText);
      
      // Add sign out button
      const signOutButton = document.createElement('button');
      signOutButton.className = 'ni-sign-out-button';
      signOutButton.textContent = 'Sign Out';
      signOutButton.addEventListener('click', () => this.logout());
      welcomeContainer.appendChild(signOutButton);
      
      // Replace sign-in container with welcome container
      signInContainer.parentNode.replaceChild(welcomeContainer, signInContainer);
    } else {
      // Just update the welcome message
      const welcomeText = welcomeContainer.querySelector('.ni-welcome-text');
      if (welcomeText) {
        welcomeText.textContent = welcomeMessage;
      }
      
      // Show welcome container, hide sign-in container
      welcomeContainer.style.display = 'block';
      signInContainer.style.display = 'none';
    }
    
    this.log('UI updated successfully with welcome message:', welcomeMessage);
  }

  /**
   * Ensure widget DOM structure exists
   */
  ensureWidgetStructure() {
    this.log('Ensuring widget structure exists');
    
    // First check if the minimal container exists
    const rootElement = document.getElementById('ni-widget-root');
    
    // If the minimal container exists but doesn't have the widget container inside
    if (rootElement && !rootElement.querySelector('.ni-widget-container')) {
      this.log('Creating widget structure inside root element');
      
      // Create the widget container
      const widgetContainer = document.createElement('div');
      widgetContainer.className = 'ni-widget-container';
      
      // Create widget header
      const widgetHeader = document.createElement('div');
      widgetHeader.className = 'ni-widget-header';
      
      const widgetTitle = document.createElement('h2');
      widgetTitle.className = 'ni-widget-title';
      widgetTitle.textContent = 'Sign in';
      
      const widgetSubtitle = document.createElement('p');
      widgetSubtitle.className = 'ni-widget-subtitle';
      widgetSubtitle.textContent = 'Choose your preferred sign-in method';
      
      widgetHeader.appendChild(widgetTitle);
      widgetHeader.appendChild(widgetSubtitle);
      widgetContainer.appendChild(widgetHeader);
      
      // Create auth buttons container
      const authButtons = document.createElement('div');
      authButtons.className = 'ni-auth-buttons';
      widgetContainer.appendChild(authButtons);
      
      // Create loading indicator
      const loading = document.createElement('div');
      loading.className = 'ni-loading';
      const spinner = document.createElement('div');
      spinner.className = 'ni-spinner';
      loading.appendChild(spinner);
      widgetContainer.appendChild(loading);
      
      // Create error message container
      const error = document.createElement('div');
      error.className = 'ni-error';
      widgetContainer.appendChild(error);
      
      // Append the complete widget to the root element
      rootElement.appendChild(widgetContainer);
      this.log('Widget structure created successfully');
    } else {
      this.log('Widget structure already exists');
    }
    
    // Now generate buttons based on config
    this.generateButtons();
  }
  
  /**
   * Generate auth buttons based on config
   */
  generateButtons() {
    this.log('Generating auth buttons based on config');
    
    // Find button container
    const buttonContainer = document.querySelector('.ni-auth-buttons');
    if (!buttonContainer) {
      this.log('Button container not found');
      return;
    }
    
    // Clear existing content
    buttonContainer.innerHTML = '';
    
    // Generate buttons for each provider
    this.config.providers.forEach(provider => {
      const button = document.createElement('button');
      button.className = 'ni-auth-button';
      button.setAttribute('data-provider-id', provider.id);
      
      const icon = document.createElement('span');
      icon.className = `ni-provider-icon ni-icon-${provider.icon}`;
      
      const text = document.createElement('span');
      text.className = 'ni-button-text';
      text.textContent = `Continue with ${provider.name}`;
      
      button.appendChild(icon);
      button.appendChild(text);
      buttonContainer.appendChild(button);
      
      this.log('Created button for provider:', provider.id);
    });
  }
}

// Initialize widget when config is available
document.addEventListener('DOMContentLoaded', () => {
  // Use global config if available
  if (window.NIWidgetConfig) {
    window.niWidget = new NIWidget(window.NIWidgetConfig);
  } else {
    console.error('Next Identity Widget configuration not found');
  }
}); 