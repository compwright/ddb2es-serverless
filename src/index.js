import retry from 'p-retry'

import { HANDLER_OPTIONS, EVENT } from './schemas.js'
import { validate } from './utils.js'
import { buildRequest } from './build-request.js'

const DEFAULT_RETRY_COUNT = 0

export default (options = {}) => {
  validate(options, HANDLER_OPTIONS)

  const {
    elasticsearch: {
      bulk: bulkOpts = {},
      client: esclient
    }
  } = options

  async function handle (event, context) {
    try {
      if (options.beforeHook) {
        options.beforeHook(event, context)
      }

      validate(event, EVENT, { allowUnknown: true })

      const parsedEvent = buildRequest(event, context, options)

      if (parsedEvent.actions.length === 0) {
        return {
          took: 0,
          errors: false,
          items: []
        }
      }

      const result = await retry(
        () => {
          return esclient.bulk({ ...bulkOpts, body: parsedEvent.actions })
            .then(result => ({ result, meta: parsedEvent.meta }))
        },
        {
          retries: DEFAULT_RETRY_COUNT,
          ...options.retryOptions
        }
      )

      if (options.afterHook) {
        const hookResult = await options.afterHook(event, context, result.result, result.meta)
        return hookResult !== undefined ? hookResult : result.result
      } else {
        return result.result
      }
    } catch (err) {
      if (options.errorHook) {
        return options.errorHook(event, context, err)
      } else {
        throw err
      }
    }
  }

  return (event, context, callback) => {
    if (callback) {
      handle(event, context)
        .then(res => callback(null, res))
        .catch(callback)
    } else {
      return handle(event, context)
    }
  }
}
