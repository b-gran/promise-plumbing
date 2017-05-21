const R = require('ramda')
const L = require('./lib')
const Either = require('ramda-fantasy').Either

const _l = console.log.bind(console)

// Given a function f that may or may not return a Promise, returns a Promise-returning
// function which returns a Promise that resolves to the return value of f
const wrap = R.compose(
  R.tryCatch(R.__, L.reject),
  R.converge(R.compose, [ R.always(L.resolve), R.identity ])
)
module.exports.wrap = wrap

// A Promise that is fulfilled after some number of milliseconds.
const delay = L.preconditions
  (L.must(R.is(Number), 'the duration must be a number'))
  (duration => new Promise(resolve => setTimeout(
    () => resolve(),
    R.is(Number, duration) ? Math.max(duration, 0) : 0
  )))
module.exports.delay = delay

// Passes a MaybePromise to a list of branching functions and resolves
// to the list of branch results. The branching functions can be Promise-returning
// or synchronous, and the value can either be a Promise or any other value.
const branch = (...branches) => valueOrPromise => Promise.resolve(valueOrPromise)
  .then(fulfilment => Promise.all(R.map(
    L.callWith(fulfilment),
    branches
  )))
module.exports.branch = branch

// Does an operation while a test returns true. The test and operation can be
// asynchronous operations. If either function rejects, exits immediately.
const whilst = R.curry((test, operation) => {
  const $test = wrap(test)
  const $operation = wrap(operation)

  return new Promise((resolve, reject) => {
    let result = []
    const iterator = operationGenerator()
    iterator.next()

    function * operationGenerator () {
      try {
        while (yield awaitPromise($test(result))) {
          result = [ ...result, yield awaitPromise($operation(result)) ]
        }
      } catch (err) {
        return reject(err)
      }

      return resolve(result)
    }

    function awaitPromise (promise) {
      promise.then(bindOwn('next', iterator)).catch(bindOwn('throw', iterator))
    }
  })
})

module.exports.whilst = whilst

// Does an operation while a test returns true. The test and operation can be
// asynchronous operations. If either function rejects, exits immediately.
// This function always performs the operation at least once --
// just like the "do while" control structure.
// doWhilst :: (Array a -> Async a) -> (Array a -> Async Boolean) -> Promise Array a
// doWhilst (operation, test)
const doWhilst = R.curry((operation, test) => whilst(
  results => R.isEmpty(results) || test(results),
  operation
))
module.exports.doWhilst = doWhilst

// Asynchronous version of compose with arguments reversed.
// Arguments to the returned function can be Promises -- they will
// be resolved in a non-deterministic order before being passed to
// the input functions.
const pipe = (...functions) => (...args) => Promise
  .all(R.map(L.resolve, args))
  .then(resolvedArguments => R.reduce(
    (promise, step) => promise.then(step),
    wrap(R.head(functions))(...resolvedArguments),
    R.tail(functions)
  ))
module.exports.pipe = pipe

const _isLengthLessThan = R.converge(
  R.pipe,
  [
    R.always(R.length),
    R.unary(R.flip(R.lt))
  ]
)

const _isLastFailure = R.pipe(R.last, Either.isLeft)

// Retry an operation some number of times before reporting failure.
// An operation "fails" if either
//   1) the operation is synchronous and it throws
//   2) the operation is a Promise and it is rejected
const retry = R.curry(L.preconditions
  (L.must(R.propSatisfies(R.is(Number), 'times'), 'times must be a number'))

  (({ times, interval }, task) => {
    const delayTask = R.isNil(interval) ? wrap(task) :
      R.pipe(
        R.length,
        R.ifElse(R.equals(0))
          (R.always(R.tap)) // just do the task on the first try
          (R.pipe(interval, delay)), // afterward, delay first
        $then(task))

    return doWhilst(
      R.pipe(delayTask, $then(Either.Right), $catch(Either.Left)),
      R.allPass([ _isLastFailure, _isLengthLessThan(times) ])
    ).then(R.pipe(R.last, Either.either(L.reject, L.resolve)))
  })
)
module.exports.retry = retry

// A helper function that binds a function property of an object to the object.
const bindOwn = R.curry(L.preconditions
  (
    L.must(
      R.compose(L.isStringRepresentable, R.nthArg(0)),
      'property must be a string, number, or Symbol'
    ),
    L.must(R.compose(L.isDefined, R.nthArg(1)), 'the object must be non-nil'),
    L.must(
      R.converge(
        R.call,
        [ R.compose(R.prop, R.nthArg(0)), R.nthArg(1) ]
      ),
      'the property must be a function'
    )
  )
  ((property, object) => object[property].bind(object))
)
module.exports.bindOwn = bindOwn

const _resolveIfNonPromise = R.ifElse(R.is(Promise), R.identity, L.resolve)

// Resolves a promise and then calls the function `prop` on the resolved value
const _resolveAndCallWith = prop => R.converge(
  R.pipe,
  [ R.always(_resolveIfNonPromise), R.always(bindOwn(prop)), L.callWith ]
)

const _isFunctionPrecondition = L.must(R.is(Function), 'handler must be a function')

// Like Promise.prototype.then, but composable and with support for non-promises (via Promise.resolve).
// Unlike Promise.prototype.then, only accepts a single argument.
const $then = L.preconditions
  (_isFunctionPrecondition)
  (_resolveAndCallWith('then'))
module.exports.$then = $then

// Like Promise.prototype.catch, but composable and with support for non-promises (via Promise.resolve).
const $catch = L.preconditions
  (_isFunctionPrecondition)
  (_resolveAndCallWith('catch'))
module.exports.$catch = $catch

// Do an operation repeatedly, stopping if the operation fails.
const times = R.pipe(_isLengthLessThan, whilst)
module.exports.times = times
