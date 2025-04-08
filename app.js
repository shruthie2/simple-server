const express = require('express');
const axios = require('axios');
const { randomUUID } = require('crypto');
const bodyParser = require('body-parser');

const app = express();
const port = process.env.PORT || 8080;
// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Simple logger
const logger = {
  log: (data) => console.log(JSON.stringify(data, null, 2)),
  error: (data) => console.error(JSON.stringify(data, null, 2))
};

// Sanitize headers for logging (remove sensitive data)
function sanitizeHeaders(headers) {
  const sanitized = { ...headers };
  const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key'];
  
  sensitiveHeaders.forEach(header => {
    if (sanitized[header]) {
      sanitized[header] = '[REDACTED]';
    }
  });
  
  return sanitized;
}

app.get('/', (req, res) => {
    res.send('Welcome to the HTTP Proxy Server! Use /execute-request to make requests.');
});

// Execute request endpoint
app.post('/execute-request', async (req, res) => {
  const requestId = randomUUID();
  const startTime = Date.now();

  try {
    const {
      url,
      method = 'GET',
      headers = {},
      data,
      params,
      responseType = 'json',
      timeout = 30000,
      followRedirects = true,
      maxRedirects = 5
    } = req.body;

    // Validate URL
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Log request details
    logger.log({
      message: 'Executing HTTP request',
      requestId,
      details: {
        url,
        method,
        headers: sanitizeHeaders(headers),
        params,
        responseType,
        timeout,
        dataSize: data ? JSON.stringify(data).length : 0
      }
    });

    // Execute the request
    const response = await axios({
      url,
      method,
      headers,
      data,
      params,
      responseType,
      timeout,
      maxRedirects: followRedirects ? maxRedirects : 0,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      validateStatus: () => true,
      decompress: true,
    });

    // Set response status
    res.status(response.status);

    // Copy all headers from the upstream response
    Object.entries(response.headers).forEach(([key, value]) => {
      // Skip transfer-encoding as it might conflict with our response
      if (key.toLowerCase() === 'transfer-encoding') return;

      if (Array.isArray(value)) {
        res.setHeader(key, value);
      } else {
        res.setHeader(key, value.toString());
      }
    });

    // Log response details
    logger.log({
      message: 'Request completed',
      requestId,
      metrics: {
        executionTime: Date.now() - startTime,
        status: response.status,
        contentType: response.headers['content-type']
      }
    });

    // For binary responses, send the raw buffer
    if (responseType === 'arraybuffer' ||
        response.headers['content-type']?.includes('application/octet-stream') ||
        response.headers['content-type']?.includes('image/') ||
        response.headers['content-type']?.includes('audio/') ||
        response.headers['content-type']?.includes('video/') ||
        response.headers['content-type']?.includes('application/pdf')) {

      // Ensure content-type is preserved
      if (!res.getHeader('content-type') && response.headers['content-type']) {
        res.setHeader('content-type', response.headers['content-type']);
      }

      // Send raw buffer for binary data
      return res.send(Buffer.from(response.data));
    }

    // For other types, send as is
    return res.send(response.data);

  } catch (error) {
    logger.error({
      message: 'Request failed',
      requestId,
      error: {
        message: error.message,
        code: error.code,
        stack: error.stack
      }
    });

    // Handle error response
    if (error.response) {
      // Copy error response headers
      Object.entries(error.response.headers).forEach(([key, value]) => {
        if (key.toLowerCase() === 'transfer-encoding') return;
        if (Array.isArray(value)) {
          res.setHeader(key, value);
        } else {
          res.setHeader(key, value.toString());
        }
      });

      return res.status(error.response.status).send(error.response.data);
    }

    // Handle network or other errors
    return res.status(500).json({
      message: error.message,
      code: error.code
    });
  }
});

// Basic health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Start the server
app.listen(port, () => {
  console.log(`Proxy server listening on port ${port}`);
});