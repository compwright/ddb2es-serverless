import { v4 as uuidv4 } from 'uuid'
import { marshall } from '@aws-sdk/util-dynamodb'

export default (records) => {
  if (!records) {
    records = [{}] // eslint-disable-line no-param-reassign
  }

  if (!Array.isArray(records)) {
    records = [records] // eslint-disable-line no-param-reassign
  }

  return {
    Records: records.map(record => {
      const eventName = record.name || 'INSERT'
      const keys = record.keys || { id: uuidv4() }
      const newImage = eventName === 'REMOVE' ? null : { ...record.new, ...keys }
      const oldImage = eventName === 'INSERT' ? null : { ...keys, ...record.old }

      return {
        eventName,
        eventSource: 'aws:dynamodb',
        dynamodb: {
          Keys: marshall(keys),
          NewImage: newImage ? marshall(newImage) : undefined,
          OldImage: oldImage ? marshall(oldImage) : undefined,
          StreamViewType: 'NEW_AND_OLD_IMAGES'
        }
      }
    })
  }
}
