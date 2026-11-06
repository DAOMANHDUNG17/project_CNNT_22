import SwaggerUI from 'swagger-ui-dist/swagger-ui-bundle.js';
import 'swagger-ui-dist/swagger-ui.css';
import '@fontsource/be-vietnam-pro/400.css';
import '@fontsource/be-vietnam-pro/500.css';
import '@fontsource/be-vietnam-pro/600.css';
import '@fontsource/be-vietnam-pro/700.css';
import './swagger.css';
import { applyDesignVariables } from './theme';
import { isCloud } from './auth/profile';

applyDesignVariables();
SwaggerUI({
  dom_id: '#swagger-ui', url: isCloud ? '/swagger/openapi-cloud.json' : '/swagger/openapi.json',
  deepLinking: true, displayOperationId: true, docExpansion: 'list', filter: true,
  defaultModelsExpandDepth: 0, supportedSubmitMethods: [],
  tryItOutEnabled: false, persistAuthorization: false, queryConfigEnabled: false,
  validatorUrl: null,
});
