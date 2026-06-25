# Source-Available Licensing Guide

## Overview
This document outlines strategies for launching a coding agent orchestration tool with source-available licensing - making source code public while maintaining commercial control.

## About This Project
This is a Vue.js application distributed via npm/npx that starts a local web server on the user's machine. The application provides an intuitive interface for orchestrating and managing coding agents, helping developers streamline their workflow through AI-powered assistance. The source code will be publicly available on GitHub under the Elastic License 2.0, allowing users to audit the code while preserving commercial rights.

## Successful Source-Available Models

### Database & Infrastructure
- **MongoDB** - Server Side Public License (SSPL)
- **Redis** - Redis Source Available License (RSAL) 
- **Elasticsearch** - Elastic License 2.0
- **CockroachDB** - Business Source License variant

### Development Tools
- **GitLab** - Community Edition (open) + Enterprise Edition (proprietary)
- **JetBrains IDEs** - Source available, commercial license required
- **n8n** - Fair-code licensing with usage limits

## License Types Comparison

### Business Source License (BSL)
- **Pros**: Flexible, well-established
- **Cons**: Automatically converts to open source after X years
- **Used by**: CockroachDB, MariaDB, Sentry

### Elastic License 2.0
- **Pros**: Permanently proprietary, allows source viewing
- **Cons**: Custom license, less standardized
- **Restrictions**: No service provision, no circumventing license

### Custom Licenses
- **Pros**: Complete control over terms
- **Cons**: Legal complexity, less familiar to users
- **Examples**: MongoDB SSPL, Redis RSAL

## Implementation Strategies

### Implementation for Local Tool
```javascript
// License validation in your npx tool
const fs = require('fs');
const path = require('path');
const os = require('os');

const LICENSE_FILE = path.join(os.homedir(), '.your-tool-license');
const TRIAL_DAYS = 30;

function checkLicense() {
  if (fs.existsSync(LICENSE_FILE)) {
    const licenseKey = fs.readFileSync(LICENSE_FILE, 'utf8').trim();
    
    // Validate license key (offline or online)
    const validation = validateLicense(licenseKey);
    if (validation.valid) {
      return { valid: true, tier: validation.tier, email: validation.email };
    }
  }
  
  // Check trial period
  const installDate = getInstallDate();
  const daysUsed = Math.floor((Date.now() - installDate) / (1000 * 60 * 60 * 24));
  
  if (daysUsed <= TRIAL_DAYS) {
    return { valid: true, tier: 'trial', daysLeft: TRIAL_DAYS - daysUsed };
  }
  
  return { valid: false };
}

// Command to add license key
function addLicense(licenseKey) {
  const validation = validateLicense(licenseKey);
  if (!validation.valid) {
    console.error('Invalid license key:', validation.reason);
    return;
  }
  
  fs.writeFileSync(LICENSE_FILE, licenseKey);
  console.log(`License activated for ${validation.email} (${validation.tier})`);
}
```

### License Key Storage Options

**Local File (Simplest)**
- Store in `~/.your-tool-license` 
- Easy to implement and debug
- Users can easily backup/transfer
- Format: `your-tool activate <license-key>`

**OS Keychain (More Secure)**
```javascript
const keytar = require('keytar');

// Store license
await keytar.setPassword('your-tool', 'license', licenseKey);

// Retrieve license  
const licenseKey = await keytar.getPassword('your-tool', 'license');
```

**Config Directory (Cross-platform)**
```javascript
const configDir = require('os').homedir() + '/.config/your-tool';
const licensePath = path.join(configDir, 'license.json');

// Store license with metadata
const licenseData = {
  key: licenseKey,
  activatedAt: Date.now(),
  email: userEmail
};
fs.writeFileSync(licensePath, JSON.stringify(licenseData));
```

### Usage-Based Limits for Local Tool
```javascript
// Track usage in local storage/file
const MONTHLY_LIMIT = {
  free: 25,
  trial: 100
};

function trackAgentOrchestration() {
  const usage = getUserUsage();
  const currentMonth = new Date().getMonth();
  
  if (usage.month !== currentMonth) {
    usage.month = currentMonth;
    usage.count = 0;
  }
  
  usage.count++;
  saveUserUsage(usage);
  
  const license = checkLicense();
  const limit = license.tier === 'pro' ? Infinity : MONTHLY_LIMIT[license.tier || 'free'];
  
  if (usage.count > limit) {
    showUpgradePrompt();
    return false;
  }
  
  return true;
}
```

### Feature Gating for Local Tool
- **Free Tier**: Basic agent orchestration, 25 orchestrations/month, single user
- **Pro Tier**: Unlimited orchestrations, advanced workflow templates, team sharing, custom integrations

### Local Tool Advantages
- **Privacy**: All processing happens locally on user's machine
- **Performance**: No network latency for orchestration tasks  
- **Reliability**: Works offline once installed
- **Trust**: Source code transparency builds developer confidence

## Enforcement Mechanisms

### 1. Honor System (Weakest)
- Rely on users to self-report and pay
- Works surprisingly well for B2B
- Example: WinRAR, some indie tools

### 2. Local Enforcement (Recommended for npm/npx tools)
- Store license info in user's home directory
- Easy for motivated users to bypass, but sufficient for honest users
- Good balance of simplicity and effectiveness for developer tools
- Example: Many CLI tools and developer utilities

### 3. Phone-Home Licensing (Strong)
- Periodic license server validation
- Harder to bypass
- Requires internet connectivity

### 4. Feature Separation (Strongest)
- Keep premium features in separate modules
- Most reliable enforcement
- Example: GitLab CE/EE model

## Recommended Approach for This Coding Agent Tool

### License Strategy
**Elastic License 2.0** (Preferred choice)
- Source code visible and auditable on GitHub
- Personal/educational use permitted  
- Commercial use requires paid license
- No automatic conversion to open source
- No redistribution or service provision without permission
- Well-established license used by Elasticsearch

### Distribution Model
- **npm package**: Distributed via `npx your-tool-name`
- **Local server**: Runs on user's machine (localhost)
- **Vue.js frontend**: Modern web interface for agent orchestration
- **No SaaS dependency**: Fully local execution with optional license validation

### Pricing Tiers
**Free Tier:**
- 25 agent orchestrations per month
- Basic workflow templates
- Community support

**Pro Tier ($4/month annually or $5/month):**
- Unlimited orchestrations
- Advanced workflow features
- Team collaboration
- Priority support
- Custom integrations

### Implementation
- Start with local enforcement and usage-based limits (simple, effective for npm tools)
- Add optional license server validation for enterprise customers
- Feature gate advanced capabilities in separate modules
- Maintain source transparency for trust and community contributions
- Leverage npm ecosystem for easy distribution and updates

## Legal Considerations

1. **Trademark protection** - Protect project name and CLI command
2. **Clear license terms** - Avoid ambiguity in Elastic License 2.0 usage
3. **Contribution agreements** - Handle community contributions to GitHub repo
4. **Enterprise compliance** - Make it easy for businesses to buy licenses
5. **DMCA protection** - Include proper copyright notices in npm package
6. **License key delivery** - Ensure reliable delivery via Stripe webhooks and email

## Recommended Architecture

### For Subscription-Based Licensing (Recommended)
**Tech Stack**: Stripe + Simple License API
- **Payment**: Stripe Checkout + Subscription webhooks
- **License Storage**: Single table database (SQLite/PostgreSQL/Supabase)
- **License Validation**: Daily phone-home with 7-day grace period
- **User Flow**: Email-based login (no passwords needed)
- **Distribution**: npm package with smart caching
- **Total Cost**: ~3.5% of revenue + $5-20/month hosting

### For One-Time Purchases (Alternative)
**Tech Stack**: Stripe + DIY License Validation
- **Payment**: Stripe Checkout + Webhooks  
- **License Storage**: No database needed
- **License Delivery**: Email + customer dashboard
- **Validation**: Offline signed licenses
- **Distribution**: npm package with embedded validation
- **Total Cost**: ~3.5% of revenue (annual billing)

### For Complex Licensing Needs
**Tech Stack**: Keygen or Similar Service
- **Payment + Licensing**: All-in-one platform
- **Features**: Advanced analytics, seat management, feature flags
- **Validation**: API-based with offline fallback
- **Distribution**: npm package with vendor SDK
- **Total Cost**: $29/month + 1% revenue

### User Flow
1. User tries tool → gets 30-day trial
2. Trial expires → shown purchase link  
3. Stripe Checkout → webhook generates license
4. Email sent with license key
5. User runs `your-tool activate <key>`
6. Tool validates and stores license locally

## E-commerce Services for Low-Cost SaaS

### License Management as a Service (Drop-in Solutions)

**Keygen (Recommended for Developer Tools)**
- **Cost**: $29/month + 1% of revenue
- **Benefits**: Purpose-built for software licensing, excellent API, offline validation
- **Features**: License keys, usage tracking, subscription management, webhook support
- **Best for**: Developer tools where licensing complexity justifies the cost
- **Integration**: Simple REST API, handles both payment and license validation

```javascript
// Keygen integration example
const response = await fetch('https://api.keygen.sh/v1/accounts/YOUR_ACCOUNT/licenses/validate', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_LICENSE_KEY',
    'Content-Type': 'application/vnd.api+json'
  },
  body: JSON.stringify({
    data: {
      type: 'license-validations',
      attributes: {
        key: userLicenseKey
      }
    }
  })
});
```

**LemonSqueezy**
- **Cost**: 5% + 50¢ per transaction (expensive for $5 tools)
- **Benefits**: Handles EU VAT, licensing, and payments in one platform
- **Features**: Built-in license key generation, customer portal, webhooks
- **Best for**: $10+ products where convenience outweighs high fees
- **Drawback**: High transaction costs for low-priced tools

**Paddle**
- **Cost**: 5% + 50¢ per transaction
- **Benefits**: Merchant of record, handles all tax compliance, licensing features
- **Features**: License management, subscription billing, global payments
- **Best for**: International sales with complex tax requirements
- **Drawback**: Very expensive for $5 monthly subscriptions

### Best Options for $5/month Price Point

**Stripe (Recommended)**
- **Cost**: 2.9% + 30¢ = ~$0.45 per $5 transaction (9% of revenue)
- **Annual billing**: $48/year = $1.69 total fees (3.5% of revenue)
- **Benefits**: Lowest fees, excellent API, global reach, excellent webhook system
- **Best for**: Developer-friendly integration with local apps

### Simple Subscription Validation (Phone-Home)

**Minimal Database + Subscription Tracking**

```javascript
// Database schema (just one table)
CREATE TABLE licenses (
  email TEXT PRIMARY KEY,
  stripe_subscription_id TEXT,
  stripe_customer_id TEXT,
  status TEXT,  -- 'active', 'cancelled', 'past_due'
  created_at TIMESTAMP,
  last_checked TIMESTAMP
);

// Stripe webhook handler (handles subscription changes)
export default async function webhook(req, res) {
  const { type, data } = req.body;
  
  switch (type) {
    case 'checkout.session.completed':
      const session = data.object;
      await db.licenses.upsert({
        email: session.customer_details.email,
        stripe_subscription_id: session.subscription,
        stripe_customer_id: session.customer,
        status: 'active',
        created_at: new Date()
      });
      
      // Email simple activation instructions
      await sendEmail({
        to: session.customer_details.email,
        subject: 'Your Subscription is Active',
        body: `Welcome! Your subscription is ready.
        
Activate with: your-tool login ${session.customer_details.email}`
      });
      break;
      
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      const subscription = data.object;
      await db.licenses.update({
        stripe_subscription_id: subscription.id,
        status: subscription.status // 'active', 'canceled', 'past_due', etc.
      });
      break;
  }
  
  res.json({ received: true });
}

// License validation API endpoint
export default async function validate(req, res) {
  const { email } = req.body;
  
  const license = await db.licenses.findOne({ email });
  
  if (!license) {
    return res.json({ valid: false, reason: 'no_license' });
  }
  
  // Update last check timestamp
  await db.licenses.update({ email }, { last_checked: new Date() });
  
  return res.json({
    valid: license.status === 'active',
    status: license.status,
    email: license.email
  });
}
```

**Tool Implementation (Smart Caching)**
```javascript
// In your npm tool
const LICENSE_FILE = path.join(os.homedir(), '.your-tool-license');
const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // Check daily

async function checkSubscription() {
  let cachedLicense = loadCachedLicense();
  
  // Skip check if we verified recently
  const timeSinceCheck = Date.now() - (cachedLicense?.lastChecked || 0);
  if (timeSinceCheck < CHECK_INTERVAL && cachedLicense?.valid) {
    return cachedLicense;
  }
  
  try {
    // Phone home to verify subscription
    const response = await fetch('https://yourdomain.com/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cachedLicense?.email }),
      timeout: 5000 // Don't hang the tool
    });
    
    const validation = await response.json();
    
    // Cache the result
    const updatedLicense = {
      ...validation,
      lastChecked: Date.now()
    };
    
    fs.writeFileSync(LICENSE_FILE, JSON.stringify(updatedLicense));
    return updatedLicense;
    
  } catch (error) {
    // Network error - use cached result if not too old
    if (cachedLicense && timeSinceCheck < 7 * 24 * 60 * 60 * 1000) { // 7 days grace
      console.warn('License check failed, using cached result');
      return cachedLicense;
    }
    
    return { valid: false, reason: 'network_error' };
  }
}

// User login flow
async function loginUser(email) {
  try {
    const validation = await fetch('https://yourdomain.com/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    
    const result = await validation.json();
    
    if (result.valid) {
      fs.writeFileSync(LICENSE_FILE, JSON.stringify({
        ...result,
        lastChecked: Date.now()
      }));
      console.log(`✅ Subscription verified for ${email}`);
    } else {
      console.error(`❌ No active subscription found for ${email}`);
    }
    
  } catch (error) {
    console.error('Failed to verify subscription:', error.message);
  }
}

function loadCachedLicense() {
  try {
    if (fs.existsSync(LICENSE_FILE)) {
      return JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8'));
    }
  } catch (error) {
    // Corrupt file, ignore
  }
  return null;
}
```

**Key Features:**
- ✅ Daily subscription validation (not every run)
- ✅ 7-day grace period for network issues  
- ✅ Automatic webhook updates from Stripe
- ✅ Simple email-based login (no passwords)
- ✅ Minimal database (one table)
- ✅ Works offline between checks
**Alternative: Database-Backed License Server**
```javascript
// When Stripe webhook confirms payment
app.post('/stripe-webhook', (req, res) => {
  const event = req.body;
  
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerEmail = session.customer_details.email;
    
    // Generate license key
    const licenseKey = generateLicenseKey(customerEmail, session.subscription);
    
    // Store in database
    await db.licenses.insert({
      key: licenseKey,
      email: customerEmail,
      tier: 'pro',
      validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      stripeSubscriptionId: session.subscription
    });
    
    // Email license key to customer
    await sendLicenseEmail(customerEmail, licenseKey);
  }
});
```

**Alternative: Cryptographically Signed Licenses (More Secure)**
```javascript
const crypto = require('crypto');

// Generate signed license (on your server)
function generateSignedLicense(email, tier, expiryDate) {
  const licenseData = {
    email,
    tier,
    expiryDate: expiryDate.getTime(),
    issued: Date.now()
  };
  
  const dataString = JSON.stringify(licenseData);
  const signature = crypto
    .createHmac('sha256', process.env.LICENSE_SECRET)
    .update(dataString)
    .digest('hex');
    
  return {
    data: dataString,
    signature
  };
}

// Validate license (in your npm tool)
function validateLicense(licenseKey) {
  try {
    const [dataString, signature] = licenseKey.split('.');
    
    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', 'your-embedded-secret')
      .update(dataString)
      .digest('hex');
      
    if (signature !== expectedSignature) {
      return { valid: false, reason: 'Invalid signature' };
    }
    
    const licenseData = JSON.parse(dataString);
    
    // Check expiry
    if (Date.now() > licenseData.expiryDate) {
      return { valid: false, reason: 'License expired' };
    }
    
    return { valid: true, ...licenseData };
  } catch (error) {
    return { valid: false, reason: 'Invalid license format' };
  }
}
```

**Alternative: Phone-Home Validation**
```javascript
// In your npm tool
async function validateLicenseOnline(licenseKey) {
  try {
    const response = await fetch('https://yourdomain.com/api/validate-license', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey })
    });
    
    return await response.json();
  } catch (error) {
    // Fallback to cached validation if offline
    return validateCachedLicense(licenseKey);
  }
}
```

**PayPal/Braintree (Alternative)**
- Similar pricing to Stripe (2.9% + 30¢)
- Good if audience prefers PayPal payments
- Slightly higher international fees

### Avoid at This Price Point
- **Paddle/LemonSqueezy**: 5% + 50¢ = $0.75 per transaction (15% of revenue)
- **Keygen**: $29/month base cost requires ~60 sales/month to break even
- Better suited for $20+ price points or high-volume products
- Tax compliance benefits don't offset high fees at low prices

### When to Consider License-as-a-Service
**Use Keygen or similar if:**
- You need complex licensing (seat limits, feature flags, usage tracking)
- Selling to enterprises requiring detailed license compliance
- Building multiple products that can share licensing costs
- Volume justifies the fixed monthly costs

**Stick with Stripe + DIY if:**
- Simple licensing needs (just validate ownership)
- Price point under $10/month
- Bootstrapping with minimal fixed costs
- Building for individual developers vs enterprises

### Pricing Strategy for Better Unit Economics
```
Recommended: Push annual billing
- Pro: $4/month (paid annually) vs $5/month
- Reduces transaction fees from 9% to 3.5%
- Standard practice for low-cost SaaS
```

### Alternative Models
```
1. Pay-per-use: $0.10 per orchestration
2. Credit system: $1 for 50 orchestrations
3. Freemium + unlimited: $3/month
```

## Marketing Benefits for Developer Tools

- **HackerNews appeal** - Source availability builds credibility in developer community
- **Developer trust** - Can audit code for security/functionality concerns
- **Community contributions** - Bug fixes and feature suggestions from users
- **Enterprise sales** - Source transparency helps with security audits and procurement
- **npm ecosystem** - Easy discovery and installation via familiar tools
- **Word of mouth** - Developers share tools that solve real problems

## Key Takeaway

Choose **Elastic License 2.0** for this coding agent orchestration tool. This provides:
- Permanent commercial control over your npm package
- Source transparency for developer trust and security audits
- Clear revenue model with simple local enforcement
- No "ticking clock" concerns for customers (unlike BSL)
- Well-established precedent in the developer tool ecosystem
- Perfect fit for locally-run Vue.js applications distributed via npm