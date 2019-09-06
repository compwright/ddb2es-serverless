const retry = require('p-retry')

const schemas = require('./schemas')
const utils = require('./utils')
const buildRequest = require('./build-request')

const DEFAULT_RETRY_COUNT = 0

module.exports = function (options = {}) {
  utils.validate(options, schemas.HANDLER_OPTIONS)

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

      utils.validate(event, schemas.EVENT, { allowUnknown: true })

      const parsedEvent = buildRequest(event, context, options)

      if (parsedEvent.actions.length === 0) {
        return {
          took: 0,
          errors: false,
          items: []
        }
      }

      const result = await retry(
        (next) => {
          return esclient.bulk({ ...bulkOpts, body: parsedEvent.actions })
            .then(result => ({ result, meta: parsedEvent.meta }))
            .catch(next)
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
