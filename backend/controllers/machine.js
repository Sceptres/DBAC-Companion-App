import { db, getUserById, getUsersIdsToUserNamesArray, updateDocument } from "../firebase.js";
import { io } from "../server.js";

const machines_observer = db.collection('machines').onSnapshot((docs) => {
  (async () => {
    try {
      const machinesData = []
      for(const doc of docs.docs) {
        var machine = doc.data();
        machine = await fillMachineActiveUser(machine);

        machinesData.push({ id: doc.id, ...machine });
      }

      // Emit machines
      io.emit('machines_changed', { machines: machinesData });
    } catch (error) {
      console.log(`Handling machines change failed: ${error}`);
    }
  })();
});

export const getMachines = async (req, res) => {
  try {
    const machinesSnap = await db.collection('machines').get();
    const allMachines = machinesSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    }));

    const filteredMachines = [];
    for(var i=0; i < allMachines.length; i++) {
      var machine = allMachines[i];
      machine = await fillMachineActiveUser(machine);

      filteredMachines.push(machine);
    }

    return res.status(200).json({
      success: true,
      machines: filteredMachines
    });
  } catch (error) {
    console.error('Error in getMachines:', error);
    return res.status(500).json({
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * 
 * @param {object} machine The machine
 * @returns The machine with the displayName of the active user
 */
async function fillMachineActiveUser(machine) {
  const userIdsArr = machine.userIds;

  var userDisplayName = null;

  if(userIdsArr.length >= 1) {
    const userId = userIdsArr[0];
    const user = await getUserById(userId);
    userDisplayName = user.displayName;
  }

  // Add current active user (owner of machine session)
  delete machine.userIds;
  machine.activeUser = userDisplayName;

  return machine;
}

/**
 * {
 *    machineId: The id of the machine to retrieve
 * }
 * 
 * @param {object} req The request object containing the request information
 * @param {object} res The response object that will be used to send a response to the client
 * @returns The response object
 */
export const getMachineInfo = async (req, res) => {
  try {
    const { machineId } = req.body;

    if(!machineId)
      return res.status(400).json({
        success: false,
        msg: "Machine Id parameter is required."
      });

    const machineRef = db.collection('machines').doc(String(machineId));
    const machineSnap = await machineRef.get();

    // check if machine exists
    if (!machineSnap.exists) {
      return res.status(404).json({
        success: false,
        msg: "Machine with the given Id is not found."
      });
    }

    var machineData = machineSnap.data();
    machineData = await fillActiveMachineUsers(machineData);

    return res.status(200).json({
      success: true,
      machine: machineData
    });
  } catch (error) {
    console.error('Error in getMachineInfo:', error);
    return res.status(500).json({
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * {
 *  machineId: The id of the machine the users wants to use,
 *  userId: The id of the user
 * }
 * 
 * @param {*} req The request object containing the request information
 * @param {object} res The response object that will be used to send a response to the client
 * @returns The response object
 */
export async function useMachine(req, res) {
  try {
    const { machineId, userId } = req.body;

    if(!machineId || !userId)
      return res.status(400).json({
        success: false,
        msg: "A required field is missing."
      });

    const machineSnap = await db.collection('machines').doc(String(machineId)).get();
    const userData = await getUserById(userId);

    if(!machineSnap.exists)
      return res.status(400).json({
        success: false,
        msg: 'No machine found with the provided id.'
      });

    if(!userData)
      return res.status(400).json({
        success: false,
        msg: 'User with the given ID cannot be verified.'
      });

    var machineData = machineSnap.data();

    if(machineData.availability !== "Free" && !machineData.workin) // Check if the user can use/join this machine.
      return res.status(200).json({
        success: false,
        msg: "Machine is currently occupied."
      });
    
    const userIdList = machineData.userIds;

    if(userIdList.length == 0) {
      // Reset machine data
      machineData.sets_left = 0;
      machineData.workin = false;
      machineData.availability = "Occupied";
    }

    // Update machine data with new ID
    machineData.userIds.push(userId);

    await updateDocument('machines', String(machineId), machineData);

    machineData = await fillActiveMachineUsers(machineData);

    io.emit(`machine_${machineId}_changed`, { machine: machineData });

    return res.status(200).json({
      success: true,
      machine: machineData
    });
  } catch (error) {
    console.error('Error in useMachine:', error);
    return res.status(500).json({
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * {
 *  machineId: The id of the machine the user wants to leave,
 *  userId: The id of the user leaving the machine
 * }
 * 
 * @param {*} req The request object containing the request information
 * @param {object} res The response object that will be used to send a response to the client
 * @returns The response object 
 */
export async function leaveMachine(req, res) {
  try {
    const { machineId, userId } = req.body;

    if(!machineId || !userId)
      return res.status(400).json({
        success: false,
        msg: "A required field is missing."
      });

    const machineSnap = await db.collection('machines').doc(String(machineId)).get();
    const userData = await getUserById(userId);

    if(!machineSnap.exists)
      return res.status(404).json({
        success: false,
        msg: 'No machine found with the provided id.'
      });

    if(!userData)
      return res.status(400).json({
        success: false,
        msg: 'User with the given ID cannot be verified.'
      });

    var machineData = machineSnap.data();
    const userIdList = machineData.userIds;
    const userIndex = userIdList.indexOf(userId);

    if(userIndex <= -1)
      return res.status(400).json({
          success: false,
          msg: `User is not using this machine.`
      });

    // Update machine data
    userIdList.splice(userIndex, 1);
    machineData.userIds = userIdList;

    if(userIdList.length == 0) { // This is the last user using the machine?
      machineData.availability = "Free";
      machineData.sets_left = 0;
      machineData.workin = false;
    }

    // Update doc in database
    await updateDocument('machines', String(machineId), machineData);

    machineData = await fillActiveMachineUsers(machineData);

    io.emit(`machine_${machineId}_changed`, { machine: machineData });

    return res.status(200).json({
      success: true,
      machine: machineData
    });
  } catch (error) {
    console.error('Error in leaveMachine:', error);
    return res.status(500).json({
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * {
 *  machineId: The id of the machine the user wants to edit,
 *  userId: The id of the user trying to edit the machine,
 *  setsLeft: The number of sets left to set,
 *  workin: The workin status of the machine
 * }
 * 
 * @param {*} req The request object containing the request information
 * @param {object} res The response object that will be used to send a response to the client
 * @returns The response object 
 */
export async function editMachineUsageParams(req, res) {
  try {
    const { machineId, userId, setsLeft, workin } = req.body;

    if(!machineId || !userId || setsLeft === undefined || workin === undefined)
      return res.status(400).json({
        success: false,
        msg: 'Missing required request parameters.'
      });

    if(setsLeft < 0 || setsLeft > 10) // Sets left can only be in the range [0, 10] (ie 0 <= setsLeft <= 10)
      return res.status(400).json({
        success: false,
        msg: "The amounts of sets left can only fall in the range [0, 10]."
      });
    
    const machineSnap = await db.collection('machines').doc(String(machineId)).get();
    const userData = await getUserById(userId);

    if(!machineSnap.exists) // Invalid machine?
      return res.status(400).json({
        success: false,
        msg: 'No machine found with the provided id.'
      });

    if(!userData) // Invalid user?
      return res.status(400).json({
        success: false,
        msg: 'User with the given ID cannot be verified.'
      });

    var machineData = machineSnap.data();

    const userIdList = machineData.userIds;
    const userIndex = userIdList.indexOf(userId);

    if(userIndex != 0) // Only the first user to use the machine can update the machine
      return res.status(400).json({
        success: false,
        msg: 'This user does not have permissions to edit this machine.'
      });

    machineData.sets_left = setsLeft;
    machineData.workin = workin;

    await updateDocument('machines', String(machineId), machineData);

    machineData = await fillActiveMachineUsers(machineData);

    io.emit(`machine_${machineId}_changed`, { machine: machineData });

    return res.status(200).json({
      success: true,
      machine: machineData
    });
  } catch (error) {
    console.error('Error in getMachineInfo:', error);
    return res.status(500).json({
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * 
 * @param {object} machineData The data of the machine
 * @returns The data of the machine with the activeUsers array
 */
async function fillActiveMachineUsers(machineData) {
  const userIdList = machineData.userIds;

  delete machineData.userIds;
  machineData.activeUsers = await getUsersIdsToUserNamesArray(userIdList);

  return machineData
}