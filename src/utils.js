import get from 'lodash/get.js'
import { unmarshall } from '@aws-sdk/util-dynamodb'

import { FieldNotFoundError } from './errors/FieldNotFoundError.js'
import { ValidationError } from './errors/ValidationError.js'

export function validate (value, schema, options) {
  const validationResult = schema.validate(
    value,
    {
      abortEarly: false,
      allowUnknown: false,
      convert: false,
      ...options
    }
  )

  if (validationResult.error) {
    throw new ValidationError(validationResult.error)
  }

  return validationResult.value
}

export function getField (parsedRecord, path) {
  const value = [parsedRecord.Keys, parsedRecord.NewImage, parsedRecord.OldImage]
    .reduce((acc, entry) => {
      return acc === undefined
        ? get(entry, path)
        : acc
    }, undefined)

  if (value === undefined) {
    throw new FieldNotFoundError(parsedRecord, path)
  }

  return value
}

export function assembleField (parsedRecord, paths, separator) {
  if (Array.isArray(paths)) {
    return paths.map(path => getField(parsedRecord, path)).join(separator)
  }
  return getField(parsedRecord, paths)
}

export function parseRecord (record) {
  return unmarshall({
    NewImage: { M: record.dynamodb.NewImage || {} },
    OldImage: { M: record.dynamodb.OldImage || {} },
    Keys: { M: record.dynamodb.Keys }
  })
}
