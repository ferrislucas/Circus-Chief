import { Router } from 'express';
import { modelProviders } from '../database.js';
import {
  CreateProviderRequest,
  UpdateProviderRequest,
  CreateProviderModelRequest,
  TestConnectionRequest,
} from '@circuschief/shared/contracts/providers';
import { testProviderConnection } from '../services/providerTestService.js';

// Error message constants
const ERR_PROVIDER_NOT_FOUND = 'Provider not found';

const router = Router();

/**
 * Redact auth token in provider response
 * @param {Object} provider - Provider object
 * @returns {Object} Provider with redacted auth token
 */
function redactAuthToken(provider) {
  if (!provider) return provider;
  return {
    ...provider,
    authToken: provider.authToken ? '••••••••' : null,
  };
}

// GET /api/providers - List all providers
router.get('/', (_req, res) => {
  try {
    const allProviders = modelProviders.getAll();
    // Redact auth tokens in response
    const sanitized = allProviders.map(redactAuthToken);
    res.json(sanitized);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/providers - Create provider
router.post('/', (req, res) => {
  const result = CreateProviderRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  try {
    const provider = modelProviders.create(result.data);
    res.status(201).json(redactAuthToken(provider));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/providers/:id - Get provider details
router.get('/:id', (req, res) => {
  try {
    const provider = modelProviders.getById(req.params.id);
    if (!provider) {
      return res.status(404).json({ error: ERR_PROVIDER_NOT_FOUND });
    }
    res.json(redactAuthToken(provider));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/providers/:id - Update provider
router.patch('/:id', (req, res) => {
  try {
    const provider = modelProviders.getById(req.params.id);
    if (!provider) {
      return res.status(404).json({ error: ERR_PROVIDER_NOT_FOUND });
    }

    const result = UpdateProviderRequest.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error.issues[0].message });
    }

    const updated = modelProviders.update(req.params.id, result.data);
    res.json(redactAuthToken(updated));
  } catch (error) {
    if (error.message === 'Cannot delete built-in provider') {
      return res.status(403).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/providers/:id - Delete provider
router.delete('/:id', (req, res) => {
  try {
    const provider = modelProviders.getById(req.params.id);
    if (!provider) {
      return res.status(404).json({ error: ERR_PROVIDER_NOT_FOUND });
    }

    modelProviders.delete(req.params.id);
    res.status(204).send();
  } catch (error) {
    if (error.message === 'Cannot delete built-in provider') {
      return res.status(403).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

// POST /api/providers/test - Test provider configuration (before saving)
router.post('/test', async (req, res) => {
  const result = TestConnectionRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  try {
    const testResult = await testProviderConnection(result.data);
    res.json(testResult);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
      details: {
        type: error.name,
      },
    });
  }
});

// POST /api/providers/:id/test - Test existing provider connection
router.post('/:id/test', async (req, res) => {
  try {
    const provider = modelProviders.getById(req.params.id);
    if (!provider) {
      return res.status(404).json({ error: ERR_PROVIDER_NOT_FOUND });
    }

    // Pick the sonnet-tiered model (if any) as the test model, falling back to any first model
    const sonnetModel = provider.models?.find((m) => m.tier === 'sonnet');
    const testConfig = {
      kind: provider.kind || 'anthropic',
      baseUrl: provider.baseUrl,
      authToken: provider.authToken,
      defaultSonnetModel: sonnetModel?.modelId,
      apiTimeoutMs: provider.apiTimeoutMs,
    };

    const testResult = await testProviderConnection(testConfig);
    res.json(testResult);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
      details: {
        type: error.name,
      },
    });
  }
});

// GET /api/providers/:id/models - List models for provider
router.get('/:id/models', (req, res) => {
  try {
    const provider = modelProviders.getById(req.params.id);
    if (!provider) {
      return res.status(404).json({ error: ERR_PROVIDER_NOT_FOUND });
    }

    const models = modelProviders.getModels(req.params.id);
    res.json(models);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/providers/:id/models - Add model to provider
router.post('/:id/models', (req, res) => {
  try {
    const provider = modelProviders.getById(req.params.id);
    if (!provider) {
      return res.status(404).json({ error: ERR_PROVIDER_NOT_FOUND });
    }

    const result = CreateProviderModelRequest.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error.issues[0].message });
    }

    const model = modelProviders.addModel(req.params.id, result.data);
    res.status(201).json(model);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/providers/:id/models/:modelId - Update model
router.patch('/:id/models/:modelId', (req, res) => {
  try {
    const provider = modelProviders.getById(req.params.id);
    if (!provider) {
      return res.status(404).json({ error: ERR_PROVIDER_NOT_FOUND });
    }

    const model = modelProviders.getModelById(req.params.modelId);
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    if (model.providerId !== req.params.id) {
      return res.status(400).json({ error: 'Model does not belong to this provider' });
    }

    const result = CreateProviderModelRequest.partial().safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error.issues[0].message });
    }

    const updated = modelProviders.updateModel(req.params.modelId, result.data);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/providers/:id/models/:modelId - Remove model
router.delete('/:providerId/models/:modelId', (req, res) => {
  try {
    const provider = modelProviders.getById(req.params.providerId);
    if (!provider) {
      return res.status(404).json({ error: ERR_PROVIDER_NOT_FOUND });
    }

    const model = modelProviders.getModelById(req.params.modelId);
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    if (model.providerId !== req.params.providerId) {
      return res.status(400).json({ error: 'Model does not belong to this provider' });
    }

    modelProviders.removeModel(req.params.modelId);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
