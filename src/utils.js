const DynamoDB = require('aws-sdk/clients/dynamodb')
const get = require('lodash/get')
const joi = require('@hapi/joi')

const FieldNotFoundError = require('./errors/FieldNotFoundError')
const ValidationError = require('./errors/ValidationError')

module.exports = {
  validate (value, schema, options) {
    const validationResult = joi.validate(
      value,
      schema,
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
  },

  getField (parsedRecord, path) {
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
  },

  assembleField (parsedRecord, paths, separator) {
    if (Array.isArray(paths)) {
      return paths.map(path => this.getField(parsedRecord, path)).join(separator)
    }
    return this.getField(parsedRecord, paths)
  },

  parseRecord (record) {
    return DynamoDB.Converter.unmarshall({
      NewImage: { M: record.dynamodb.NewImage || {} },
      OldImage: { M: record.dynamodb.OldImage || {} },
      Keys: { M: record.dynamodb.Keys }
    })
  }
}
