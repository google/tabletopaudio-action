/* Copyright 2019, Google, Inc.
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  BasicCard,
  Button,
  dialogflow,
  DialogflowConversation,
  Image,
  MediaObject,
  SimpleResponse,
  Suggestions,
} from 'actions-on-google'
import { TabletopAudioTrack, TabletopAudioResponse } from './tabletopAudio'
import * as functions from 'firebase-functions'
import fetch from 'node-fetch'

const tabletopAudioUrl = 'https://tabletopaudio.com/tta_data'

import { sessionEntitiesHelper, SessionEntitiesPlugin } from 'actions-on-google-dialogflow-session-entities-plugin'
const app = dialogflow<Conv>({
  debug: true
}).use(sessionEntitiesHelper())


app.middleware(async (conv: Conv) => {
  await cacheResults(conv)
  setSessionEntities(conv)
})

const setSessionEntities = (conv: Conv) => {
  // Create sets for each type of entity type
  const trackTitles = new Set<string>()
  const trackGenres = new Set<string>()
  const trackTags = new Set<string>()

  conv.data.json.tracks.forEach(track => {
    trackTitles.add(track.track_title)
    track.track_genre.forEach(genre => {
      trackGenres.add(genre)
    })
    track.tags.forEach(tag => {
      trackTags.add(tag)
    })
  })

  conv.sessionEntities.add({
    name: 'track',
    entities: Array.from(trackTitles).map(title => {
      return {
        value: title,
        synonyms: [title]
      }
    })
  })
  conv.sessionEntities.add({
    name: 'genre',
    entities: Array.from(trackGenres).map(genre => {
      return {
        value: genre,
        synonyms: [genre]
      }
    })
  })
  conv.sessionEntities.add({
    name: 'tag',
    entities: Array.from(trackTags).map(tag => {
      return {
        value: tag,
        synonyms: [tag]
      }
    })
  })
}

interface TabletopAudioSession {
  json: TabletopAudioResponse,
  currentTrack: TabletopAudioTrack,
  sessionEntities: SessionEntitiesPlugin
}

interface Conv extends DialogflowConversation<TabletopAudioSession> {
  sessionEntities: SessionEntitiesPlugin
}

async function cacheResults(conv: Conv) {
  if (!conv.data.json) {
    const response = await fetch(tabletopAudioUrl)
    const json: TabletopAudioResponse = await response.json()
    conv.data.json = json
  }
}

app.intent('Default Welcome Intent', async (conv) => {
  if (conv.user.last.seen) {
    // Welcome back user
    conv.ask(new SimpleResponse({
      text: 'Welcome back! What do you want to listen to?',
      speech: `Welcome back! By the way, the track ` +
        `${conv.data.json.tracks[0].track_title} was recently added. ` +
        `What do you want to listen to?`
    }))
    conv.ask(new Suggestions(conv.data.json.tracks[0].track_title))
    conv.ask(new Suggestions(`What's new?`))
  } else {
    // New user
    conv.ask(new SimpleResponse({
      text: 'Welcome to Tabletop Audio! I can play a specific track, ' +
        'or start playing based on a genre. What do you want to listen to?',
      speech: `Welcome to Tabletop Audio! I can play a specific track ` +
        `like ${conv.data.json.tracks[0].track_title}, or start playing based on a genre like ` +
        `${conv.data.json.tracks[0].track_genre}. What do you want to listen to?`
    }))
    conv.ask(new Suggestions(`Help`))
    conv.ask(new Suggestions(`What's new?`))
  }
  conv.ask(getSuggestions(conv.data.json.tracks))
  conv.sessionEntities.send()
})

function generateMediaResponse(track: TabletopAudioTrack): MediaObject {
  return new MediaObject({
    name: track.track_title,
    url: track.link,
    description: track.flavor_text,
    image: new Image({
      url: track.large_image,
      alt: `Track art for ${track.track_title!}`
    })
  })
}

function getSuggestionTrackTitle(track: TabletopAudioTrack): string {
  return track.track_title
}

function getSuggestionTrackGenre(track: TabletopAudioTrack): string {
  return track.track_genre[0]
}

function getSuggestionTag(track: TabletopAudioTrack): string {
  return track.tags[0]
}

type SuggestionGenerator = (track: TabletopAudioTrack) => string

function getSuggestions(tracks: TabletopAudioTrack[]): Suggestions {
  const suggestions = []
  const suggestionGenerators: SuggestionGenerator[] = [
    getSuggestionTrackTitle,
    getSuggestionTrackGenre,
    getSuggestionTag
  ]
  // Generate six suggestions
  for (let i = 0; i < 6; i++) {
    const randomTrack = tracks[Math.floor(Math.random() * tracks.length)]
    const mod = i % 3
    suggestions.push(suggestionGenerators[mod](randomTrack))
  }
  return new Suggestions(suggestions)
}

function sanitizeTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/(\w):(\w)/g, '$1 $2')
    .replace(/:/g, '')
}

function searchAndPlay(conv: Conv, searchString: string) {
  const search = sanitizeTitle(searchString)
  const searchResults = []

  for (const track of conv.data.json.tracks) {
    // "forest: day" => "forest day"
    const title = sanitizeTitle(track.track_title)
    const genres = track.track_genre.map((g: string) => g.toLowerCase())
    const tags = track.tags.map((t: string) => t.toLowerCase())
    if (title.indexOf(search) > -1) {
      conv.ask(`Here is ${track.track_title}.`)
      conv.ask(generateMediaResponse(track))
      conv.ask(getSuggestions(conv.data.json.tracks))
      conv.data.currentTrack = track
      return
    }
    if (genres.includes(search) || tags.includes(search)) {
      // Pick a random item from the result
      searchResults.push(track)
    }
  }
  if (searchResults.length) {
      const track = searchResults[Math.floor(Math.random() * searchResults.length)]
      conv.ask(`I found several tracks for the category ${search}. Here is one at random: `+
        `${track.track_title}.`)
      conv.ask(generateMediaResponse(track))
      conv.ask(getSuggestions(conv.data.json.tracks))
      conv.data.currentTrack = track
      return
  }
  const suggestions: Suggestions = getSuggestions(conv.data.json.tracks)
  conv.ask(new SimpleResponse({
    text: `I can't find a track with that description. What else do you want to listen to?`,
    speech: `I can't find a track with that description, but I found others like ` +
      `${suggestions.suggestions[0].title}. ` +
      `You can also ask "What are the latest tracks?". ` +
      `What would you like to listen to?`
  }))
  conv.ask(suggestions)
}

app.intent<{ search: string }>('Play', async (conv, params) => {
  searchAndPlay(conv, params.search)
})

app.intent<{ title?: string, genre?: string, tag?: string }>
    ('Play Entity', async (conv, params) => {
  // "Orbital Platform" => "orbital platform"
  const searchString = params.title || params.genre || params.tag
  if (!searchString) {
    conv.ask(`I apologize, I do not know what you are looking for. What do you want to play?`)
    return
  }
  searchAndPlay(conv, searchString)
})

app.intent('Repeat', (conv) => {
  const track = conv.data.currentTrack
  if (!track) {
    conv.ask('Sorry, I do not know what track you want to play. ' +
      'What else do you want to listen to?')
    conv.ask(getSuggestions(conv.data.json.tracks))
    return
  }
  conv.ask(`Once again, here's ${track.track_title}`)
  conv.ask(generateMediaResponse(track))
  conv.ask(getSuggestions(conv.data.json.tracks))
})

app.intent('Current', (conv) => {
  const track = conv.data.currentTrack
  if (!track) {
    conv.ask(`Sorry, I don't think anything is playing. What do you want to listen to?`)
    conv.ask(getSuggestions(conv.data.json.tracks))
    return
  }
  conv.ask(`This is ${track.track_title} from Tabletop Audio. ${track.flavor_text}`)
  conv.ask(getSuggestions(conv.data.json.tracks))
})

app.intent('New', (conv) => {
  const newestTracks = conv.data.json.tracks.slice(0, 3)
  conv.ask('The last three tracks added to Tabletop Audio are: ' +
    newestTracks.map(track => track.track_title) +
    '. What do you want to listen to?')
  conv.ask(new Suggestions(...newestTracks.map(track => track.track_title)))
})

app.intent('Help', (conv) => {
  conv.ask('Tabletop Audio is the premier advertising-free, free-to-use, and user-supported ' +
    'ambient game audio site on the Internet. Visit the website to view a complete list of ' +
    'tracks. You can also ask me "What are the latest tracks", ask for a specific song like ' +
    `${conv.data.json.tracks[0].track_title}, or ask to play music from a genre like ` +
    `${conv.data.json.tracks[0].track_genre}. What do you want to do?`)
  conv.ask(new BasicCard({
    title: 'Tabletop Audio',
    image: new Image({
      // Banner image on black bg
      url: 'https://firebasestorage.googleapis.com/v0/b/tabletopaudio.appspot.com/o/Screenshot%20from%202019-05-20%2011-48-52.png?alt=media',
      alt: 'Tabletop Audio banner image'
    }),
    buttons: new Button({
      title: 'View website',
      url: 'https://tabletopaudio.com'
    })
  }))
})

app.intent<{ search: string }>('Search', async (conv, params) => {
  const search = params.search.toLowerCase()
  const trackOut = []
  for (const track of conv.data.json.tracks) {
    const title = track.track_title.toLowerCase()
    const genres = track.track_genre.map((g: string) => g.toLowerCase())
    const tags = track.tags.map((t: string) => t.toLowerCase())
    if (title.indexOf(search) > -1 || genres.includes(search) || tags.includes(search)) {
      trackOut.push(track.track_title)
    }
  }
  if (trackOut.length === 1) {
    conv.ask(`There is 1 track. It is called ${trackOut[0]}. What should I play?`)
    return
  }
  if (trackOut.length > 1) {
    conv.ask(`There are ${trackOut.length} tracks that I found.`)
    conv.ask(`The first three are called ${trackOut.slice(0,3).join(', ')}. What should I play?`)
    conv.ask(new Suggestions(trackOut.slice(0, 8)))
    return
  }
  const suggestions: Suggestions = getSuggestions(conv.data.json.tracks)
  conv.ask(new SimpleResponse({
    text: 'I am unable to find that audio for you. What else do you want to listen to?',
    speech: `I am unable to find that audio, but I found others like ` +
      `${suggestions.suggestions[0].title}. What would you like to listen to?`
  }))
  conv.ask(suggestions)
})

app.intent('actions.intent.MEDIA_STATUS', (conv) => {
  const mediaStatus = conv.arguments.get('MEDIA_STATUS')
  let response = 'Unknown media status received.'
  if (mediaStatus && mediaStatus.status === 'FINISHED') {
    response = 'Hope you enjoyed that song. What else do you want to listen to?';
  }
  conv.ask(response)
  conv.ask(new Suggestions('Repeat'))
  conv.ask(getSuggestions(conv.data.json.tracks))
})

exports.dialogflowFirebaseFulfillment = functions.https.onRequest(app);
