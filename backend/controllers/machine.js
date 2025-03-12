import { db, getUserById, updateDocument } from "../firebase.js";

export const getMachines = async (req, res) => {
  try {
    const machinesSnap = await db.collection('machines').get();
    const machines = machinesSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    res.status(200).send(machines);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch machines" });
  }
};

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
      return res.status(404).json({
        success: false,
        error: "Machine Id parameter is required."
      });

    const machineRef = db.collection('machines').doc(String(machineId));
    const machineSnap = await machineRef.get();

    // check if machine exists
    if (!machineSnap.exists) {
      return res.status(404).json({
        success: false,
        error: "Machine with the given Id is not found."
      });
    }

    const machineData = machineSnap.data();
    const userIdList = machineData.userIds;

    for(var i=0; i < userIdList.length; i++) {
      const uid = userIdList[i];
      const userData = await getUserById(uid);
      userIdList[i] = userData !== undefined ? userData.displayName : '';
    }

    delete machineData.userIds;
    machineData.ativeUsers = userIdList;

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
        error: "A required field is missing."
      });

    const machineSnap = await db.collection('machines').doc(String(machineId)).get();
    const userData = await getUserById(userId);

    if(!machineSnap.exists)
      return res.status(400).json({
        success: false,
        error: 'No machine found with the provided id.'
      });

    if(!userData)
      return res.status(400).json({
        success: false,
        error: 'User with the given ID cannot be verified.'
      });

    const machineData = machineSnap.data();

    if(machineData.availability !== "Free")
      return res.status(400).json({
        success: false,
        error: "Machine is currently occupied."
      });

    // Reset machine data
    machineData.sets_left = 0;
    machineData.workin = false;

    // Update machine data with new ID
    machineData.availability = "Occupied";
    machineData.userIds.push(userId);

    await updateDocument('machines', String(machineId), machineData);

    delete machineData.userIds;
    machineData.ativeUsers = [userData.displayName];

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
