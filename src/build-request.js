const pick = require('lodash/pick')

const schemas = require('./schemas')
const UnknownEventNameError = require('./errors/UnknownEventNameError')
const utils = require('./utils')

function buildDoc (parsedRecord, options) {
  const doc = options.pickFields
    ? pick(parsedRecord.NewImage, options.pickFields)
    : parsedRecord.NewImage

  if (options.transformRecordHook) {
    return options.transformRecordHook(doc, parsedRecord.OldImage)
  }
  return doc
}

function buildAction (parsedRecord, options) {
  const {
    separator = '.',
    indexPrefix = ''
  } = options

  const doc = buildDoc(parsedRecord, options)

  const idResolver = options.idResolver || (() => {
    return options.idField
      ? utils.assembleField(parsedRecord, options.idField, separator)
      : utils.assembleField(parsedRecord, Object.keys(parsedRecord.Keys), separator)
  })

  const id = idResolver(doc, parsedRecord.OldImage)

  const actionDescriptionObj = {
    _index: options.index ||
      `${indexPrefix}${utils.assembleField(parsedRecord, options.indexField, separator)}`,
    _type: options.type ||
      (
        options.typeField &&
        utils.assembleField(parsedRecord, options.typeField, separator)
      ),
    _id: id
  }

  // Omit blank _type
  if (!actionDescriptionObj._type) {
    delete actionDescriptionObj._type
  }

  if (options.parentField) {
    actionDescriptionObj.parent = utils.getField(parsedRecord, options.parentField)
  }

  if (options.versionResolver || options.versionField) {
    const version = options.versionResolver
      ? options.versionResolver(doc, parsedRecord.OldImage)
      : utils.getField(parsedRecord, options.versionField)
    utils.validate(version, schemas.VERSION.label(options.versionField || 'resolved version'))
    actionDescriptionObj.version = version
    actionDescriptionObj.versionType = 'external'
  }

  return {
    doc,
    action: actionDescriptionObj
  }
}

function buildRequest (event, context, options) {
  return event.Records.reduce((acc, record) => {
    try {
      const parsedRecord = utils.parseRecord(record)
      const { action: actionDescriptionObj, doc } = buildAction(parsedRecord, options)

      if (doc) {
        let action
        switch (record.eventName) {
          case 'INSERT':
          case 'MODIFY':
            action = { index: actionDescriptionObj }
            acc.actions.push(action)
            acc.actions.push(doc)
            break

          case 'REMOVE':
            if (actionDescriptionObj && typeof actionDescriptionObj.version !== 'undefined') {
              actionDescriptionObj.version++
            }
            action = { delete: actionDescriptionObj }
            acc.actions.push(action)
            break

          default:
            throw new UnknownEventNameError(record)
        }

        acc.meta.push({
          event: {
            ...record,
            dynamodb: {
              ...record.dynamodb,
              ...parsedRecord
            }
          },
          action,
          document: doc
        })
      }
    } catch (err) {
      if (options.recordErrorHook) {
        options.recordErrorHook(event, context, err)
      } else {
        throw err
      }
    }

    return acc
  }, { actions: [], meta: [] })
}

module.exports = buildRequest

module.exports.buildDoc = buildDoc
module.exports.buildAction = buildAction
