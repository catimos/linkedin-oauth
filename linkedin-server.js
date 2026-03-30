Linkedin = {}

const getImage = profilePicture => {
  const image = []
  if (profilePicture !== undefined){
    for (const element of profilePicture['displayImage~'].elements) {
      for (const identifier of element.identifiers) {
        image.push(identifier.identifier)
      }
    }
  }
  return {
    displayImage: profilePicture ? profilePicture.displayImage : null,
    identifiersUrl: image
  }
}

/*
With OpenID (openid profile email), you should NOT use
https://api.linkedin.com/v2/emailAddress.
The endpoint https://api.linkedin.com/v2/userinfo gives email which is primary email
LinkedIn does NOT expose secondary emails via OpenID.
*/
// Request for email, returns array
const getEmails = function(accessToken) {
  const url = encodeURI(
    `https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))&oauth2_access_token=${accessToken}`,
  )
  const response = HTTP.get(url).data
  const emails = []
  for (const element of response.elements) {
    emails.push(element['handle~'].emailAddress)
  }
  return emails
}

// checks whether a string parses as JSON
const isJSON = function(str) {
  try {
    JSON.parse(str)
    return true
  } catch (e) {
    return false
  }
}


/* Step 2. Exchange code for token:
  POST https://www.linkedin.com/oauth/v2/accessToken
  grant_type=authorization_code
  code=AUTH_CODE
  redirect_uri=YOUR_REDIRECT_URI
  client_id=YOUR_CLIENT_ID
  client_secret=YOUR_CLIENT_SECRET
 */ 
// returns an object containing:
// - accessToken
// - expiresIn: lifetime of token in seconds
const getTokenResponse = function(query) {
  const config = ServiceConfiguration.configurations.findOne(
    { service: 'linkedin' },
  )
  if (!config)
    throw new ServiceConfiguration.ConfigError(
      'Service not configured',
    )

  let responseContent
  try {
    // Request an access token
    responseContent = HTTP.post(
      //'https://api.linkedin.com/uas/oauth2/accessToken',
      'https://www.linkedin.com/oauth/v2/accessToken',
      {
        params: {
          grant_type: 'authorization_code',
          client_id: config.clientId,
          client_secret: OAuth.openSecret(config.secret),
          code: query.code,
          redirect_uri: OAuth._redirectUri(
            'linkedin',
            config,
          ),
        },
      },
    ).content
  } catch (err) {
    throw new Error(
      `Failed to complete OAuth handshake with Linkedin. ${
        err.message
      }`,
    )
  }

  // If 'responseContent' does not parse as JSON, it is an error.
  if (!isJSON(responseContent)) {
    throw new Error(
      `Failed to complete OAuth handshake with Linkedin. ${responseContent}`,
    )
  }

  // Success! Extract access token and expiration
  const parsedResponse = JSON.parse(responseContent)
  const accessToken = parsedResponse.access_token
  const expiresIn = parsedResponse.expires_in

  if (!accessToken) {
    throw new Error(
      'Failed to complete OAuth handshake with Linkedin ' +
        `-- can't find access token in HTTP response. ${responseContent}`,
    )
  }

  return {
    accessToken,
    expiresIn,
  }
}

/*
step 3. Fetch user info:
GET https://api.linkedin.com/v2/userinfo
sample response 8 fields
{
    "sub": "782bbtaQ",
    "name": "John Doe",
    "given_name": "John",
    "family_name": "Doe",
    "picture": "https://media.licdn-ei.com/dms/image/C5F03AQHqK8v7tB1HCQ/profile-displayphoto-shrink_100_100/0/",
    "locale": "en-US",
    "email": "doe@email.com",   // Optional
    "email_verified": true      // Optional
}
*/
// Request available fields from r_liteprofile
const getIdentity = function(accessToken) {
  try {
    //`https://api.linkedin.com/v2/me?projection=(id,firstName,lastName,profilePicture(displayImage~:playableStreams))&oauth2_access_token=${accessToken}`,

    const url = encodeURI(
      `https://api.linkedin.com/v2/userinfo?projection=(sub,name,given_name,family_name,picture(displayImage~:playableStreams),locale,email,email_verified)&oauth2_access_token=${accessToken}`,
    )
    //return HTTP.get(url).data
    return HTTP.get(url, {
        headers: {
          'LinkedIn-Version': '202301',
          //'X-Restli-Protocol-Version': '2.0.0'
        }
    }).data;
  } catch (err) {
    throw new Error(
      `Failed to fetch identity from Linkedin. ${
        err.message
      }`,
    )
  }
}

OAuth.registerService('linkedin', 2, null, query => {
  const response = getTokenResponse(query)
  const accessToken = response.accessToken
  const identity = getIdentity(accessToken)

  //console.log("=======================response="+JSON.stringify(response))
  //console.log("=======================accessToken="+JSON.stringify(accessToken))
  //console.log("=======================identity="+JSON.stringify(identity))
  /*
  const {
    id,
    firstName,
    lastName,
    profilePicture,
  } = identity
  */
  
  const id = identity.sub;
  if (!id) {
    throw new Error('Linkedin did not provide an id')
  }
  
  const serviceData = {
    id,
    accessToken,
    expiresAt: +new Date() + 1000 * response.expiresIn,
  }
  
  //const emails = [];//====getEmails(accessToken)

  /*
  const fields = {
    linkedinId: id,
    firstName,
    lastName,
    profilePicture: getImage(profilePicture),
    emails,
  }
  */
  // storing all the 8 fields
  const fields = {
    linkedinId: id,
    firstName: identity.given_name,
    lastName: identity.family_name,
    name: identity.name,
    email: identity.email,
    email_verified: identity.email_verified,
    locale: identity.locale,
    profilePicture: getImage(identity.picture)
  }

  /*
  if (emails.length) {
    const primaryEmail = emails[0]
    fields.emailAddress = primaryEmail // for backward compatibility with previous versions of this package
    fields.email = primaryEmail
  }
  */
  
  _.extend(serviceData, fields)

  return {
    serviceData,
    options: {
      profile: fields,
    },
  }
})

Linkedin.retrieveCredential = function(
  credentialToken,
  credentialSecret,
) {
  return OAuth.retrieveCredential(
    credentialToken,
    credentialSecret,
  )
}
