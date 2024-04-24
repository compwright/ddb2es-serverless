import pick from 'lodash/pick.js'

import { VERSION } from './schemas.js'
import { UnknownEventNameError } from './errors/UnknownEventNameError.js'
import { assembleField, getField, validate, parseRecord } from './utils.js'

export function buildDoc (parsedRecord, options) {
  const doc = options.pickFields
    ? pick(parsedRecord.NewImage, options.pickFields)
    : parsedRecord.NewImage

  if (options.transformRecordHook) {
    return options.transformRecordHook(doc, parsedRecord.OldImage)
  }
  return doc
}

export function buildAction (parsedRecord, options) {
  const {
    separator = '.',
    indexPrefix = ''
  } = options

  const doc = buildDoc(parsedRecord, options)

  const idResolver = options.idResolver || (() => {
    return options.idField
      ? assembleField(parsedRecord, options.idField, separator)
      : assembleField(parsedRecord, Object.keys(parsedRecord.Keys), separator)
  })

  const id = idResolver(doc, parsedRecord.OldImage)

  const actionDescriptionObj = {
    _index: options.index ||
      `${indexPrefix}${assembleField(parsedRecord, options.indexField, separator)}`,
    _type: options.type ||
      (
        options.typeField &&
        assembleField(parsedRecord, options.typeField, separator)
      ),
    _id: id
  }

  // Omit blank _type
  if (!actionDescriptionObj._type) {
    delete actionDescriptionObj._type
  }

  if (options.parentField) {
    actionDescriptionObj.parent = getField(parsedRecord, options.parentField)
  }

  if (options.versionResolver || options.versionField) {
    const version = options.versionResolver
      ? options.versionResolver(doc, parsedRecord.OldImage)
      : getField(parsedRecord, options.versionField)
    validate(version, VERSION.label(options.versionField || 'resolved version'))
    actionDescriptionObj.version = version
    actionDescriptionObj.versionType = 'external'
  }

  return {
    doc,
    action: actionDescriptionObj
  }
}

export function buildRequest (event, context, options) {
  return event.Records.reduce((acc, record) => {
    try {
      const parsedRecord = parseRecord(record)
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
