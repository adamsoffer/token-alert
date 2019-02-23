import client from '@sendgrid/client'
import url from 'url'
import moment from 'moment'
import agenda from '../agenda'

require('now-env')

client.setApiKey(process.env.SENDGRID_API_KEY)
client.setDefaultHeader('User-Agent', 'token-alert/1.0.0')

const optIn = 'opt-in'

// Send confirmation email to contact with link to confirm email
export const sendConfirmation = async (req, res) => {
  let emailBody = req.body
  try {
    let [response] = await client.request({
      method: 'POST',
      url: '/v3/mail/send',
      body: prepareConfirmationEmail(emailBody)
    })
    res.status(response.statusCode).send(response)
  } catch (e) {
    res.status(400).send(e)
  }
}

export const dispatch = async function(req: any, res: any) {
  if (req.query.accessToken !== process.env.SENDGRID_API_KEY) {
    return res.sendStatus(401)
  }

  let parsedUrl = url.parse(req.body[0]['url'], true)

  switch (parsedUrl.pathname) {
    case '/unsubscribe':
      await unsubscribe({ ...req.body[0] })
      break
    case '/':
      if (parsedUrl.query.verify) {
        await addUser({ ...req.body[0] })
      }
      break
    default:
      return
  }
  res.sendStatus(200)
}

async function cancelJob({ frequency, email, delegatorAddress }) {
  try {
    // delete job
    await agenda.cancel({
      name: 'email',
      'data.frequency': frequency,
      'data.email': email,
      'data.delegatorAddress': delegatorAddress
    })
  } catch (e) {
    console.log(e)
  }
}

async function unsubscribe({ frequency, email, delegatorAddress }) {
  try {
    let recipient_id = await getRecipientId(email)
    let list_id = await getListId({ recipient_id, frequency, delegatorAddress })

    await deleteRecipientFromList({ list_id, recipient_id })
    await cancelJob({ frequency, email, delegatorAddress })
  } catch (e) {
    console.log(e)
  }
}

// Create new contact and add contact to given list
async function addUser({ frequency, email, delegatorAddress, type, timeSent }) {
  try {
    let contactID = await createRecipient({
      type,
      timeSent,
      email
    })
    if (contactID) {
      await addRecipientToList({ contactID, delegatorAddress, frequency })
      await createEmailJob({ frequency, email, delegatorAddress })
    }
  } catch (e) {
    console.log(e)
  }
}

async function createEmailJob({ frequency, email, delegatorAddress }) {
  let everyFridayAt7am = '0 7 * * 5'
  let firstOfEveryMonthAt7am = '0 7 1 * *'
  let job = await agenda.create('email', {
    frequency,
    email,
    delegatorAddress
  })
  job.unique({ frequency, email, delegatorAddress })
  job.repeatEvery(
    `${frequency == 'weekly' ? everyFridayAt7am : firstOfEveryMonthAt7am}`
  )
  job.save()
}

async function getRecipientId(email) {
  try {
    let [response] = await client.request({
      method: 'GET',
      url: `/v3/contactdb/recipients/search?email=${email}`
    })
    return response.body.recipients[0].id
  } catch (e) {
    console.log(e)
  }
}

async function getListId({ recipient_id, frequency, delegatorAddress }) {
  try {
    let [response] = await client.request({
      method: 'GET',
      url: `/v3/contactdb/recipients/${recipient_id}/lists`
    })
    let listId = response.body.lists.filter(
      (list: any) => list.name == `${delegatorAddress} - ${frequency}`
    )[0].id
    return listId.toString()
  } catch (e) {
    console.log(e)
  }
}

async function deleteRecipientFromList({ list_id, recipient_id }) {
  try {
    let [response] = await client.request({
      method: 'DELETE',
      url: `/v3/contactdb/lists/${list_id}/recipients/${recipient_id}`
    })
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return true
    } else {
      return false
    }
  } catch (e) {
    console.log(e)
  }
}

function prepareConfirmationEmail(reqBody) {
  let subject = 'Please Confirm Your Email Address'
  let confirmationLink = `${process.env.URL}/?verify=true&frequency=${
    reqBody.frequency
  }`
  let todaysDate = moment().format('MMM D, YYYY')

  let emailBody = {
    personalizations: [
      {
        to: [
          {
            email: reqBody.email
          }
        ],
        subject: subject,
        custom_args: {
          type: optIn,
          timeSent: String(Date.now())
        },
        dynamic_template_data: {
          todaysDate,
          confirmationLink,
          frequency: reqBody.frequency,
          delegatorAddress: reqBody.delegatorAddress
        }
      }
    ],
    from: {
      email: 'noreply@livepeer.org',
      name: 'Livepeer'
    },
    reply_to: {
      email: 'noreply@livepeer.org',
      name: 'Livepeer'
    },
    template_id: 'd-b3812189ecf74b92aefe1d98b34ec054'
  }

  for (let key in reqBody) {
    if ({}.hasOwnProperty.call(reqBody, key)) {
      emailBody.personalizations[0].custom_args[key] = reqBody[key]
    }
  }

  return emailBody
}

async function createRecipient({ type, timeSent, email }) {
  let secondsInDay = 86400
  let timeElapsed = (Date.now() - Number(timeSent)) / 1000

  // Confirm email type is opt in and link has been clicked within 1 day
  if (type === optIn && timeElapsed < secondsInDay) {
    // Create recipient
    let [response] = await client.request({
      method: 'POST',
      url: '/v3/contactdb/recipients',
      body: [
        {
          email
        }
      ]
    })
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return response.body.persisted_recipients[0]
    } else {
      return false
    }
  }
}

async function addRecipientToList({ contactID, delegatorAddress, frequency }) {
  let [, body] = await client.request({
    method: 'GET',
    url: '/v3/contactdb/lists'
  })

  let list = body.lists.filter(
    (list: any) => list.name == `${delegatorAddress} - ${frequency}`
  )[0]

  // If list doesn't exist, create it
  if (!list) {
    ;[, list] = await client.request({
      method: 'POST',
      url: '/v3/contactdb/lists',
      body: { name: `${delegatorAddress} - ${frequency}` }
    })
  }

  // add contact to list
  await client.request({
    method: 'POST',
    url: '/v3/contactdb/lists/' + list.id + '/recipients/' + contactID
  })
}
