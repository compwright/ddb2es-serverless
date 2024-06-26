/* eslint-env mocha */

import { expect, use } from 'chai'
import chaiSubset from 'chai-subset'
import { Client } from '@elastic/elasticsearch'
import lambdaTester from 'lambda-tester'
import sinon from 'sinon'
import { v4 as uuidv4 } from 'uuid'

import lambdaHandler from '../src/index.js'
import { FieldNotFoundError } from '../src/errors/FieldNotFoundError.js'
import { UnknownEventNameError } from '../src/errors/UnknownEventNameError.js'
import { ValidationError } from '../src/errors/ValidationError.js'
import formatEvent from './utils/ddb-stream-event-formatter.js'

use(chaiSubset)

function formatErrorMessage (messages) {
  return messages.join('. ')
}

describe('handler', function () {
  before(function () {
    lambdaTester.checkForResourceLeak(true)
  })

  describe('options validation', function () {
    it('should handle case when options object is not passed', function () {
      expect(() => lambdaHandler()).to.throw(ValidationError)
    })

    it('should throw when incompatible options are present', function () {
      const testOptions = {
        es: {},
        elasticsearch: {},
        idField: 'id',
        idResolver: () => {},
        index: 'foo',
        indexField: 'bar',
        indexPrefix: 'baz',
        type: 'foo',
        typeField: 'bar',
        versionField: '_v',
        versionResolver: () => {}
      }

      expect(() => lambdaHandler(testOptions))
        .to.throw(ValidationError)
        .with.property('message', formatErrorMessage([
          '"elasticsearch.client" is required',
          '"es" is not allowed',
          '"options" contains a conflict between optional exclusive peers [idField, idResolver]',
          '"options" contains a conflict between optional exclusive peers [versionField, versionResolver]',
          '"options" contains a conflict between exclusive peers [index, indexField]',
          '"options" contains a conflict between optional exclusive peers [type, typeField]',
          '"index" conflict with forbidden peer "indexPrefix"'
        ]))
    })

    it('should throw when options are invalid (first set)', function () {
      const testOptions = {
        es: 'foo',
        beforeHook: {},
        afterHook: {},
        recordErrorHook: {},
        errorHook: {},
        transformRecordHook: {},
        separator: 5,
        idField: {},
        indexField: {},
        indexPrefix: 5,
        typeField: {},
        parentField: {},
        pickFields: {},
        versionField: {},
        retryOptions: 2
      }

      expect(() => lambdaHandler(testOptions))
        .to.throw(ValidationError)
        .with.property('message', formatErrorMessage([
          '"elasticsearch" is required',
          '"beforeHook" must be of type function',
          '"afterHook" must be of type function',
          '"recordErrorHook" must be of type function',
          '"errorHook" must be of type function',
          '"transformRecordHook" must be of type function',
          '"separator" must be a string',
          '"idField" must be one of [string, array]',
          '"indexField" must be one of [string, array]',
          '"indexPrefix" must be a string',
          '"typeField" must be one of [string, array]',
          '"parentField" must be a string',
          '"pickFields" must be one of [string, array]',
          '"versionField" must be a string',
          '"retryOptions" must be of type object',
          '"es" is not allowed'
        ]))
    })

    it('should throw when options are invalid (second set)', function () {
      const testOptions = {
        elasticsearch: 'foo',
        idResolver: 1,
        index: 1,
        type: 2,
        versionResolver: 3
      }

      expect(() => lambdaHandler(testOptions))
        .to.throw(ValidationError)
        .with.property('message', formatErrorMessage([
          '"elasticsearch" must be of type object',
          '"idResolver" must be of type function',
          '"index" must be a string',
          '"type" must be a string',
          '"versionResolver" must be of type function'
        ]))
    })

    it('should throw when required options are missing', function () {
      const testOptions = {
        indexPrefix: 'foo'
      }

      expect(() => lambdaHandler(testOptions))
        .to.throw(ValidationError)
        .with.property('message', formatErrorMessage([
          '"elasticsearch" is required',
          '"options" must contain at least one of [index, indexField]',
          '"indexPrefix" missing required peer "indexField"'
        ]))
    })

    it('should throw when elasticsearch options are invalid', function () {
      const testOptions = {
        elasticsearch: {
          bulk: ''
        },
        index: 'index',
        type: 'type'
      }

      expect(() => lambdaHandler(testOptions))
        .to.throw(ValidationError)
        .with.property('message', formatErrorMessage([
          '"elasticsearch.client" is required',
          '"elasticsearch.bulk" must be of type object'
        ]))
    })

    it('should throw when elasticsearch.bulk options are invalid', function () {
      const testOptions = {
        elasticsearch: {
          bulk: {
            body: {}
          }
        },
        index: 'index',
        type: 'type'
      }

      expect(() => lambdaHandler(testOptions))
        .to.throw(ValidationError)
        .with.property('message', formatErrorMessage([
          '"elasticsearch.client" is required',
          '"elasticsearch.bulk.body" is not allowed'
        ]))
    })

    it('should throw when unknown options passed', function () {
      const testOptions = {
        elasticsearch: {
          client: new Client({ node: 'https://foo' })
        },
        junk: 'junk',
        index: 'index',
        type: 'type'
      }

      expect(() => lambdaHandler(testOptions))
        .to.throw(ValidationError)
        .with.property('message', formatErrorMessage([
          '"junk" is not allowed'
        ]))
    })
  })

  describe('hooks', function () {
    it('should call "beforeHook" when provided', function () {
      let hookCalled = false
      const testEvent = formatEvent()

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        beforeHook: (event, context) => {
          hookCalled = true
          expect(event).to.deep.equal(testEvent)
          expect(context)
            .to.exist
            .and.to.have.property('awsRequestId')
        },
        index: 'index',
        type: 'type'
      })

      sinon.stub(client, 'bulk').resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => {
          expect(hookCalled).to.be.equal(true)
        })
    })

    it('should call "afterHook" when provided', function () {
      const testResult = {
        meaningOfLife: 42
      }

      let hookCalled = false
      const testItemKeys = { id: uuidv4() }
      const testItemData = { data: 'some data', nestedData: { data: 'nested data' } }
      const testEvent = formatEvent({
        name: 'INSERT',
        keys: testItemKeys,
        new: testItemData
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        afterHook: (event, context, result, parsedRecords) => {
          hookCalled = true
          expect(event).to.deep.equal(testEvent)
          expect(context)
            .to.exist
            .and.to.have.property('awsRequestId')
          expect(result)
            .to.exist
            .and.to.deep.equal(testResult)
          expect(parsedRecords)
            .to.exist
            .and.to.deep.equal([
              {
                event: {
                  eventName: 'INSERT',
                  eventSource: testEvent.Records[0].eventSource,
                  dynamodb: {
                    Keys: testItemKeys,
                    NewImage: { ...testItemKeys, ...testItemData },
                    OldImage: {},
                    StreamViewType: testEvent.Records[0].dynamodb.StreamViewType
                  }
                },
                action: { index: { _index: 'index', _type: 'type', _id: testItemKeys.id } },
                document: { ...testItemKeys, ...testItemData }
              }
            ])
        },
        index: 'index',
        type: 'type'
      })

      const stub = sinon.stub(client, 'bulk').resolves(testResult)

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => {
          expect(stub.called).to.be.equal(true)
          expect(hookCalled).to.be.equal(true)
        })
    })

    it('should use return value from "afterHook" when provided', function () {
      const testEvent = formatEvent()
      const testHookResult = uuidv4()

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        afterHook: () => {
          return Promise.resolve(testHookResult)
        },
        index: 'index',
        type: 'type'
      })

      sinon.stub(client, 'bulk').resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(result => {
          expect(result).to.be.deep.equal(testHookResult)
        })
    })

    it('should call "recordErrorHook" when provided and should not throw', function () {
      let hookCalled = false
      const testEvent = formatEvent()

      const handler = lambdaHandler({
        elasticsearch: {
          client: new Client({ node: 'https://foo' })
        },
        recordErrorHook: (event, context, err) => {
          hookCalled = true
          expect(event).to.deep.equal(testEvent)
          expect(context)
            .to.exist
            .and.to.have.property('awsRequestId')
          expect(err).to.exist
            .and.to.be.an.instanceOf(FieldNotFoundError)
            .with.property('message', '"foo" field not found in record')
        },
        indexField: 'foo',
        type: 'type'
      })

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => {
          expect(hookCalled).to.be.equal(true)
        })
    })

    it('should call "errorHook" when provided, return result and should not throw', function () {
      let hookCalled = false
      const testResult = uuidv4()
      const testEvent = formatEvent()
      const testError = new Error('Winter is coming!')

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        errorHook: (event, context, err) => {
          hookCalled = true
          expect(event).to.deep.equal(testEvent)
          expect(context).to.exist.and.to.have.property('awsRequestId')
          expect(err).to.exist.and.to.deep.equal(testError)
          return testResult
        },
        index: 'index',
        type: 'type'
      })

      const stub = sinon.stub(client, 'bulk').rejects(testError)

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(result => {
          expect(stub.called).to.be.equal(true)
          expect(hookCalled).to.be.equal(true)
          expect(result).to.equal(testResult)
        })
    })

    it('should call "transformRecordHook" when provided', function () {
      let hookCalled = false
      const originalRecord = {
        someProperty: 'someValue'
      }
      const oldRecord = {
        someProperty: 'someOldValue'
      }
      const transformedRecord = {
        someProperty: 'otherValue'
      }
      const testEvent = formatEvent({
        name: 'MODIFY',
        new: originalRecord,
        old: oldRecord
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        transformRecordHook: (record, old) => {
          hookCalled = true
          expect(record).to.have.property('someProperty').that.equals(originalRecord.someProperty)
          expect(old).to.have.property('someProperty').that.equals(oldRecord.someProperty)
          return transformedRecord
        },
        index: 'index',
        type: 'type'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value)
            .to.have.nested.property('body[1]')
            .that.deep.equals(transformedRecord)
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => {
          expect(hookCalled).to.be.equal(true)
          mock.verify()
        })
    })

    it('should skip record when "transformRecordHook" does not return object', function () {
      let hookCalled = false
      const testEvent = formatEvent({
        name: 'INSERT',
        new: {
          someProperty: 'someValue'
        }
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        transformRecordHook: () => {
          hookCalled = true
          return null
        },
        afterHook: (event, context, result, meta) => {
          expect(meta).to.deep.equal([])
        },
        index: 'index',
        type: 'type'
      })

      const mock = sinon.mock(client).expects('bulk').never()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => {
          expect(hookCalled).to.be.equal(true)
          mock.verify()
        })
    })
  })

  describe('separator', function () {
    it('should use separator when provided', function () {
      const testSeparator = '~'
      const testField1 = uuidv4()
      const testField2 = uuidv4()
      const testEvent = formatEvent({
        name: 'INSERT',
        keys: {
          field1: testField1,
          field2: testField2
        }
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        separator: testSeparator,
        indexField: ['field1', 'field2'],
        typeField: ['field1', 'field2']
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          const expectedConcat = `${testField1}${testSeparator}${testField2}`
          return expect(value).to.have.nested.property('body[0].index')
            .that.containSubset({
              _id: expectedConcat,
              _index: expectedConcat,
              _type: expectedConcat
            })
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })

    it('should support empty separator', function () {
      const testField1 = uuidv4()
      const testField2 = uuidv4()
      const testEvent = formatEvent({
        name: 'INSERT',
        keys: {
          field1: testField1,
          field2: testField2
        }
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        separator: '',
        indexField: ['field1', 'field2'],
        typeField: ['field1', 'field2']
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          const expectedConcat = `${testField1}${testField2}`
          return expect(value).to.have.nested.property('body[0].index')
            .that.containSubset({
              _id: expectedConcat,
              _index: expectedConcat,
              _type: expectedConcat
            })
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })
  })

  describe('id', function () {
    it('should use "idResolver" when provided', function () {
      const testField = uuidv4()
      const testEvent = formatEvent({
        name: 'INSERT',
        keys: {
          field: testField,
          otherField: uuidv4()
        },
        new: {
          field: testField,
          otherField: uuidv4()
        }
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        idResolver: record => record.field,
        index: 'index',
        type: 'type'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.have.nested.property('body[0].index._id', testField)
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })

    it('should use "idField" when provided (single field)', function () {
      const testField = uuidv4()
      const testEvent = formatEvent({
        name: 'INSERT',
        keys: {
          field: testField,
          otherField: uuidv4()
        }
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        idField: 'field',
        index: 'index',
        type: 'type'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.have.nested.property('body[0].index._id', testField)
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })

    it('should use "idField" when provided (multiple fields)', function () {
      const testField1 = uuidv4()
      const testField2 = uuidv4()
      const testEvent = formatEvent({
        name: 'INSERT',
        keys: {
          field1: testField1,
          field2: testField2,
          field3: uuidv4()
        }
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        idField: ['field1', 'field2'],
        index: 'index',
        type: 'type'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.have.nested.property('body[0].index._id', `${testField1}.${testField2}`)
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })

    it('should throw when "idField" not found in record', function () {
      const testEvent = formatEvent()
      const handler = lambdaHandler({
        elasticsearch: {
          client: new Client({ node: 'https://foo' })
        },
        idField: 'notFoundField',
        index: 'index',
        type: 'type'
      })

      return lambdaTester(handler)
        .event(testEvent)
        .expectError(err => {
          expect(err)
            .to.be.an.instanceOf(FieldNotFoundError)
            .with.property('message', '"notFoundField" field not found in record')
        })
    })

    it('should concatenate record keys when "idField" not provided', function () {
      const testField1 = uuidv4()
      const testField2 = uuidv4()
      const testEvent = formatEvent({
        name: 'INSERT',
        keys: {
          field1: testField1,
          field2: testField2
        }
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: 'index',
        type: 'type'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.have.nested.property('body[0].index._id', `${testField1}.${testField2}`)
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })
  })

  describe('index', function () {
    it('should use "index" value when provided', function () {
      const testIndex = uuidv4()
      const testEvent = formatEvent({ name: 'INSERT' })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: testIndex,
        type: 'type'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.have.nested.property('body[0].index._index', testIndex)
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })

    it('should use "indexField" when provided (single field)', function () {
      const testField = uuidv4()
      const testEvent = formatEvent({
        name: 'INSERT',
        keys: { field: testField }
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        indexField: 'field',
        type: 'type'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.have.nested.property('body[0].index._index', testField)
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })

    it('should use "indexField" when provided (multiple fields)', function () {
      const testField1 = uuidv4()
      const testField2 = uuidv4()
      const testEvent = formatEvent({
        name: 'INSERT',
        keys: {
          field1: testField1,
          field2: testField2
        }
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        indexField: ['field1', 'field2'],
        type: 'type'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.have.nested.property('body[0].index._index', `${testField1}.${testField2}`)
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })

    it('should use "indexPrefix" when provided', function () {
      const testField = uuidv4()
      const testIndexPrefix = uuidv4()
      const testEvent = formatEvent({
        name: 'INSERT',
        keys: { field: testField }
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        indexField: 'field',
        indexPrefix: testIndexPrefix,
        type: 'type'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value)
            .to.have.nested.property('body[0].index._index', `${testIndexPrefix}${testField}`)
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })

    it('should throw when "indexField" not found in record', function () {
      const testEvent = formatEvent()
      const handler = lambdaHandler({
        elasticsearch: {
          client: new Client({ node: 'https://foo' })
        },
        indexField: 'notFoundField',
        type: 'type'
      })

      return lambdaTester(handler)
        .event(testEvent)
        .expectError(err => {
          expect(err)
            .to.be.an.instanceOf(FieldNotFoundError)
            .with.property('message', '"notFoundField" field not found in record')
        })
    })
  })

  describe('type', function () {
    it('should use "type" value when provided', function () {
      const testType = uuidv4()
      const testEvent = formatEvent({ name: 'INSERT' })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: 'index',
        type: testType
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.have.nested.property('body[0].index._type', testType)
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })

    it('should use "typeField" when provided (single field)', function () {
      const testField = uuidv4()
      const testEvent = formatEvent({
        name: 'INSERT',
        keys: { field: testField }
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: 'index',
        typeField: 'field'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.have.nested.property('body[0].index._type', testField)
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })

    it('should use "typeField" when provided (multiple fields)', function () {
      const testField1 = uuidv4()
      const testField2 = uuidv4()
      const testEvent = formatEvent({
        name: 'INSERT',
        keys: {
          field1: testField1,
          field2: testField2
        }
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: 'index',
        typeField: ['field1', 'field2']
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.have.nested.property('body[0].index._type', `${testField1}.${testField2}`)
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })

    it('should throw when "typeField" not found in record', function () {
      const testEvent = formatEvent()
      const handler = lambdaHandler({
        elasticsearch: {
          client: new Client({ node: 'https://foo' })
        },
        index: 'index',
        typeField: 'notFoundField'
      })

      return lambdaTester(handler)
        .event(testEvent)
        .expectError(err => {
          expect(err)
            .to.be.an.instanceOf(FieldNotFoundError)
            .with.property('message', '"notFoundField" field not found in record')
        })
    })
  })

  describe('parentField', function () {
    it('should use "parentField" when provided', function () {
      const testField = uuidv4()
      const testEvent = formatEvent({
        name: 'INSERT',
        new: {
          field: testField,
          otherField: uuidv4()
        }
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: 'index',
        type: 'type',
        parentField: 'field'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.have.nested.property('body[0].index.parent', testField)
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })

    it('should throw when "parentField" not found in record', function () {
      const testEvent = formatEvent()
      const handler = lambdaHandler({
        elasticsearch: {
          client: new Client({ node: 'https://foo' })
        },
        index: 'index',
        type: 'type',
        parentField: 'notFoundField'
      })

      return lambdaTester(handler)
        .event(testEvent)
        .expectError(err => {
          expect(err)
            .to.be.an.instanceOf(FieldNotFoundError)
            .with.property('message', '"notFoundField" field not found in record')
        })
    })
  })

  describe('pickFields', function () {
    it('should use "pickFields" when provided (single field)', function () {
      const testDoc = {
        field1: uuidv4(),
        field2: uuidv4()
      }
      const testEvent = formatEvent({
        name: 'INSERT',
        new: testDoc
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: 'index',
        type: 'type',
        pickFields: 'field1'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.have.nested.property('body[1]')
            .that.deep.equals({ field1: testDoc.field1 })
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })

    it('should use "pickFields" when provided (multiple fields)', function () {
      const testDoc = {
        field1: uuidv4(),
        field2: uuidv4(),
        field3: uuidv4()
      }
      const testEvent = formatEvent({
        name: 'INSERT',
        new: testDoc
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: 'index',
        type: 'type',
        pickFields: ['field1', 'field2']
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.have.nested.property('body[1]')
            .that.deep.equals({ field1: testDoc.field1, field2: testDoc.field2 })
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })

    it('should use "pickFields" when provided (dot notation)', function () {
      const testDoc = {
        field1: uuidv4(),
        field2: uuidv4(),
        foo: {
          bar: 'baz'
        }
      }
      const testEvent = formatEvent({
        name: 'INSERT',
        new: testDoc
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: 'index',
        type: 'type',
        pickFields: [
          'field1',
          'foo.bar'
        ]
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.have.nested.property('body[1]')
            .that.deep.equals({
              field1: testDoc.field1,
              foo: {
                bar: 'baz'
              }
            })
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })

    it('should pick all the fields when "pickFields" not provided', function () {
      const testDoc = {
        field1: uuidv4(),
        field2: uuidv4()
      }
      const testEvent = formatEvent({
        name: 'INSERT',
        new: testDoc,
        keys: {
          field1: testDoc.field1
        }
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: 'index',
        type: 'type'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.have.nested.property('body[1]')
            .that.deep.equals(testDoc)
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })
  })

  describe('version', function () {
    it('should use field`s value when "versionField" is provided', function () {
      const testDoc = {
        field1: uuidv4(),
        field2: 1
      }
      const testEvent = formatEvent({
        name: 'INSERT',
        new: testDoc,
        keys: {
          field1: testDoc.field1
        }
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: 'index',
        type: 'type',
        versionField: 'field2'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.containSubset({
            body: [
              { index: { version: testDoc.field2, versionType: 'external' } }
            ]
          })
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })

    it('should use the resolved value when "versionResolver" is provided', function () {
      const testDoc = {
        field1: uuidv4(),
        field2: 'asdf',
        v: 3
      }
      const testEvent = formatEvent({
        name: 'INSERT',
        new: testDoc,
        keys: {
          field1: testDoc.field1
        }
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: 'index',
        type: 'type',
        versionResolver: doc => doc.v
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.containSubset({
            body: [
              { index: { version: 3, versionType: 'external' } }
            ]
          })
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })

    it('should support 0 version', function () {
      const testDoc = {
        field1: uuidv4(),
        field2: 0
      }
      const testEvent = formatEvent({
        name: 'INSERT',
        new: testDoc,
        keys: {
          field1: testDoc.field1
        }
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: 'index',
        type: 'type',
        versionField: 'field2'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.containSubset({
            body: [
              { index: { version: testDoc.field2, versionType: 'external' } }
            ]
          })
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })

    it('should not set "version" and "versionType" fields when neither "versionField" nor "versionResolver" is provided', function () {
      const testDoc = {
        field1: uuidv4()
      }
      const testEvent = formatEvent({
        name: 'INSERT',
        new: testDoc,
        keys: {
          field1: testDoc.field1
        }
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: 'index',
        type: 'type'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.have.nested.property('body[0].index')
            .that.not.have.any.keys('version', 'versionType')
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })

    it('should throw when "versionField" not found in record', function () {
      const testEvent = formatEvent()
      const handler = lambdaHandler({
        elasticsearch: {
          client: new Client({ node: 'https://foo' })
        },
        index: 'index',
        type: 'type',
        versionField: 'notFoundField'
      })

      return lambdaTester(handler)
        .event(testEvent)
        .expectError(err => {
          expect(err)
            .to.be.an.instanceOf(FieldNotFoundError)
            .with.property('message', '"notFoundField" field not found in record')
        })
    })

    it('should throw when version is invalid', function () {
      const testEvent = formatEvent({
        name: 'INSERT',
        new: {
          _version: '1'
        },
        keys: {
          key: uuidv4()
        }
      })

      const handler = lambdaHandler({
        elasticsearch: {
          client: new Client({ node: 'https://foo' })
        },
        index: 'index',
        type: 'type',
        versionField: '_version'
      })

      return lambdaTester(handler)
        .event(testEvent)
        .expectError(err => {
          expect(err)
            .to.be.an.instanceOf(ValidationError)
            .with.property('message', '"_version" must be a number')
        })
    })

    it('should throw when resolved version is invalid', function () {
      const testEvent = formatEvent({
        name: 'INSERT',
        new: {
          _version: '1'
        },
        keys: {
          key: uuidv4()
        }
      })

      const handler = lambdaHandler({
        elasticsearch: {
          client: new Client({ node: 'https://foo' })
        },
        index: 'index',
        type: 'type',
        versionResolver: doc => doc._version
      })

      return lambdaTester(handler)
        .event(testEvent)
        .expectError(err => {
          expect(err)
            .to.be.an.instanceOf(ValidationError)
            .with.property('message', '"resolved version" must be a number')
        })
    })

    it('should increment version for "REMOVE" event', function () {
      const testDoc = {
        field1: uuidv4(),
        field2: 1
      }
      const testEvent = formatEvent({
        name: 'REMOVE',
        old: testDoc,
        keys: {
          field1: testDoc.field1
        }
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: 'index',
        type: 'type',
        versionField: 'field2'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.containSubset({
            body: [
              { delete: { version: testDoc.field2 + 1, versionType: 'external' } }
            ]
          })
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })
  })

  describe('event validation', function () {
    it('should throw when invalid event received', function () {
      const testEvent = formatEvent()
      delete testEvent.Records[0].eventName
      delete testEvent.Records[0].dynamodb

      const handler = lambdaHandler({
        elasticsearch: {
          client: new Client({ node: 'https://foo' })
        },
        index: 'index',
        type: 'type'
      })

      return lambdaTester(handler)
        .event(testEvent)
        .expectError(err => {
          expect(err)
            .to.be.an.instanceOf(ValidationError)
            .with.property('message', '"Records[0].eventName" is required. "Records[0].dynamodb" is required')
        })
    })

    it('should call errorHook and not throw when invalid event received and errorHook passed', function () {
      let hookCalled = false

      const testEvent = formatEvent()
      delete testEvent.Records[0].eventName

      const handler = lambdaHandler({
        elasticsearch: {
          client: new Client({ node: 'https://foo' })
        },
        index: 'index',
        type: 'type',
        errorHook: (event, context, err) => {
          hookCalled = true
          expect(err).to.be.an.instanceOf(ValidationError)
        }
      })

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => {
          expect(hookCalled).to.be.equal(true)
        })
    })

    it('should not throw when event has unknown fields', function () {
      const testEvent = formatEvent()
      testEvent.junk = 'junk'
      testEvent.Records[0].junk = 'junk'
      testEvent.Records[0].dynamodb.junk = 'junk'

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: 'index',
        type: 'type'
      })

      sinon.stub(client, 'bulk').resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult()
    })
  })

  describe('event names (types)', function () {
    it('should support "INSERT" event', function () {
      const testDoc = {
        field1: uuidv4(),
        field2: uuidv4()
      }
      const testEvent = formatEvent({
        name: 'INSERT',
        new: testDoc,
        keys: {
          field1: testDoc.field1
        }
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: 'index',
        type: 'type'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.containSubset({
            body: [
              { index: { _index: 'index', _type: 'type', _id: testDoc.field1 } },
              testDoc
            ]
          })
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })

    it('should support "MODIFY" event', function () {
      const testDoc = {
        field1: uuidv4(),
        field2: uuidv4()
      }
      const testEvent = formatEvent({
        name: 'MODIFY',
        new: testDoc,
        keys: {
          field1: testDoc.field1
        }
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: 'index',
        type: 'type'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.containSubset({
            body: [
              { index: { _index: 'index', _type: 'type', _id: testDoc.field1 } },
              testDoc
            ]
          })
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })

    it('should support "REMOVE" event', function () {
      const testDoc = {
        field1: uuidv4(),
        field2: uuidv4()
      }
      const testEvent = formatEvent({
        name: 'REMOVE',
        new: testDoc,
        keys: {
          field1: testDoc.field1
        }
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: 'index',
        type: 'type'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.containSubset({
            body: [
              { delete: { _index: 'index', _type: 'type', _id: testDoc.field1 } }
            ]
          })
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })

    it('should throw when unknown event name found', function () {
      const testEvent = formatEvent({
        name: 'UNKNOWN'
      })

      const handler = lambdaHandler({
        elasticsearch: {
          client: new Client({ node: 'https://foo' })
        },
        index: 'index',
        type: 'type'
      })

      return lambdaTester(handler)
        .event(testEvent)
        .expectError(err => {
          expect(err).to.be.an.instanceOf(UnknownEventNameError)
          expect(err).to.have.property('message', '"UNKNOWN" is an unknown event name')
          expect(err).to.have.property('details').that.deep.equals(testEvent.Records[0])
        })
    })

    it('should call recordErrorHook and not throw when unknown event name found and recordErrorHook passed', function () {
      let handlerCalled = false
      const testEvent = formatEvent({
        name: 'UNKNOWN'
      })

      const handler = lambdaHandler({
        elasticsearch: {
          client: new Client({ node: 'https://foo' })
        },
        index: 'index',
        type: 'type',
        recordErrorHook: (event, context, err) => {
          handlerCalled = true
          expect(err).to.be.an.instanceOf(UnknownEventNameError)
          expect(err).to.have.property('message', '"UNKNOWN" is an unknown event name')
          expect(err).to.have.property('details').that.deep.equals(testEvent.Records[0])
        }
      })

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(result => {
          expect(handlerCalled).to.be.equal(true)
          expect(result).to.deep.equal({
            took: 0,
            errors: false,
            items: []
          })
        })
    })

    it('should omit _type from insert operation if type options are not given', function () {
      const testKeys = { id: uuidv4() }
      const testEvent = formatEvent({ name: 'INSERT', keys: testKeys })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: 'index'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs({
          body: [
            {
              index: {
                _index: 'index',
                _id: testKeys.id
              }
            },
            testKeys
          ]
        })
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })
  })

  describe('events count', function () {
    it('should support single event', function () {
      const testDoc = { field: uuidv4() }
      const testEvent = formatEvent({
        name: 'INSERT',
        keys: { field: testDoc.field },
        newImage: testDoc
      })

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: 'index',
        type: 'type'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.containSubset({
            body: [
              { index: { _id: testDoc.field } },
              testDoc
            ]
          })
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })

    it('should support multiple events', function () {
      const testDoc1 = { field: uuidv4() }
      const testDoc2 = { field: uuidv4() }
      const testEvent = formatEvent([
        {
          name: 'INSERT',
          keys: { field: testDoc1.field },
          newImage: testDoc1
        },
        {
          name: 'MODIFY',
          keys: { field: testDoc2.field },
          newImage: testDoc2
        }
      ])

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: 'index',
        type: 'type'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs(sinon.match(value => {
          return expect(value).to.containSubset({
            body: [
              { index: { _id: testDoc1.field } },
              testDoc1,
              { index: { _id: testDoc2.field } },
              testDoc2
            ]
          })
        }))
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })
  })

  describe('bulk options', function () {
    it('should pass bulk options to the request when provided', function () {
      const testKeys = { id: uuidv4() }
      const testEvent = formatEvent({ name: 'INSERT', keys: testKeys })
      const testBulkOptions = {
        refresh: 'true'
      }

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: {
          client,
          bulk: testBulkOptions
        },
        index: 'index',
        type: 'type'
      })

      const mock = sinon.mock(client).expects('bulk')
        .once()
        .withExactArgs({
          body: [
            {
              index: {
                _index: 'index',
                _type: 'type',
                _id: testKeys.id
              }
            },
            testKeys
          ],
          refresh: testBulkOptions.refresh
        })
        .resolves()

      return lambdaTester(handler)
        .event(testEvent)
        .expectResult(() => mock.verify())
    })
  })

  describe('retryOptions', function () {
    it('should not retry on error when retryOptions is not passed', function () {
      const testEvent = formatEvent()
      const testError = new Error('indexing error')

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: 'index',
        type: 'type'
      })

      const stub = sinon.stub(client, 'bulk').rejects(testError)

      return lambdaTester(handler)
        .event(testEvent)
        .expectError(err => {
          expect(stub.calledOnce).to.be.equal(true)
          expect(err).to.deep.equal(testError)
        })
    })

    it('should retry on error specified number of times when retryOptions is passed', function () {
      const testEvent = formatEvent()
      const testError = new Error('indexing error')
      const retryCount = 2

      const client = new Client({ node: 'https://foo' })

      const handler = lambdaHandler({
        elasticsearch: { client },
        index: 'index',
        type: 'type',
        retryOptions: {
          retries: retryCount
        }
      })

      const stub = sinon.stub(client, 'bulk').rejects(testError)

      return lambdaTester(handler)
        .event(testEvent)
        .expectError(err => {
          expect(stub.callCount).to.be.equal(retryCount + 1)
          expect(err).to.deep.equal(testError)
        })
    })
  })
})
